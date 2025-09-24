// sockets/handlers/chatMessageHandler.js
const jwt = require("jsonwebtoken");
const Message = require("../../models/Message");
const User = require("../../models/User");
const filterMessage = require("../../utils/filter");

// serverweite Map (Modul-Scope) für Timeouts: normalizedUsername -> timestamp (ms)
const userTimeouts = new Map();

module.exports = function(socket, ctx) {
  let {
    username,
    activeUsers,
    userRoles,
    userFilters,
    lastMessageTime,
    trimOldMessages,
    emitToAdmins,
    authenticatedSockets,
    JWT_SECRET,
    ADMIN_PASS,
    io
  } = ctx;

  // Hilfsfunktionen
  const normalize = (u) => String(u || "").trim().toLowerCase();
  const messageHistory = new Map();

  const findActiveSocketsFor = (targetNorm) => {
    // activeUsers kann keys in original-case haben -> suche case-insensitiv
    for (const [uname, socketsSet] of activeUsers.entries()) {
      if (normalize(uname) === targetNorm) return socketsSet;
    }
    return null;
  };

  socket.on("chatMessage", async (content) => {
    // username ist pro-socket; falls nicht gesetzt, ignorieren
    if (!username) return;

    // NOW definieren (unbedingt VOR Timeout-Check)
    const now = Date.now();

    // --- Prüfen, ob der User gemutet ist (normalized) ---
    const myNorm = normalize(username);
    const timeoutUntil = userTimeouts.get(myNorm);
    if (timeoutUntil && now < timeoutUntil) {
      // sende eine System-Nachricht mit verbleibender Dauer (ms)
      const remainingMs = timeoutUntil - now;
      socket.emit("systemMessage", {
        text: `⚠️ Du bist noch für ${Math.ceil(remainingMs / 1000)} Sekunden gemutet.`,
        type: "error",
        duration: remainingMs
      });
      return; // wichtig: Verarbeitungs-Stopp
    }

    // --- Lade DB-User & Rolle ---
    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    const HISTORY_LIMIT = 5;
    const TIME_WINDOW = 10000; // 10 Sekunden
    const SPAM_TIMEOUT = 30;   // 30 Sekunden
    
    const history = messageHistory.get(username) || [];
    
    // Nur die letzten 10 Sekunden behalten
    const recent = history.filter(ts => now - ts <= TIME_WINDOW);
    recent.push(now);
    messageHistory.set(username, recent);
    
    if (recent.length > HISTORY_LIMIT) {
      // User für 30 Sekunden muten
      const timeoutUntil = now + SPAM_TIMEOUT * 1000;
      userTimeouts.set(username, timeoutUntil);
      setTimeout(() => userTimeouts.delete(username), SPAM_TIMEOUT * 1000);
    
      socket.emit("systemMessage", { 
        text: `⚠️ Du hast zu viele Nachrichten gesendet und wurdest für ${SPAM_TIMEOUT} Sekunden gemutet.`, 
        type: "error" 
      });
      
    }

    let finalContent = (content || "").trim();

    // --- Befehle (beginnt mit "/") ---
    if (finalContent.startsWith("/")) {

      // kein Command
      if (finalContent === "/") {
        socket.emit("systemMessage", { text: `ℹ️ Kein Kommando eingegeben!`, type: "info" });
        return;
      }

      // /role
      if (finalContent === "/role") {
        const r = userRoles.get(username) || dbUser?.role || "user";
        socket.emit("systemMessage", { text: `ℹ️ Deine Rolle ist: ${r}`, type: "info" });
        return;
      }

      // /help
      if (finalContent === "/help") {
        socket.emit("systemMessage", {
              text: `
            ℹ️ **Befehle:**  
            /admin [passwort]                  → Admin werden  
            /ban "username" [passwort]        → User bannen  
            /clear                            → Chat leeren (Admins)  
            /deleteAllUsers [passwort]        → Alle normalen User löschen  
            /reset [passwort]                  → Server zurücksetzen  
            /role                             → Zeigt deine aktuelle Rolle  
            /timeout "username" DauerInSekunden → User temporär muten (Admins)  
            /help                             → Zeigt diese Nachricht
              `.trim(),
              type: "info",
              duration: 15000
            });
        return;
      }

      // /admin [passwort]
      const adminMatch = finalContent.match(/^\/admin\s*(?:[:]\s*)?(.*)$/i);
      if (adminMatch) {
        const provided = (adminMatch[1] || "").trim();
        if (provided && provided === ADMIN_PASS) {
          if (dbUser) {
            dbUser.role = "admin";
            await dbUser.save();
          }
          role = "admin";
          userRoles.set(username, role);

          const newToken = jwt.sign({ username, role }, JWT_SECRET, { expiresIn: "7d" });
          socket.emit("newToken", { token: newToken });
          socket.emit("systemMessage", { text: "✔️ Du bist jetzt Admin.", type: "ok" });

          for (const sid of authenticatedSockets) {
            io.to(sid).emit("roleUpdated", { username, role });
          }

          emitToAdmins("adminNotice", { text: `${username} ist jetzt Admin.` });
        } else {
          socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
        }
        return;
      }

      // /clear
      if (finalContent === "/clear") {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
        await Message.deleteMany({});
        io.emit("deletedMessages", []);
        for (const sid of authenticatedSockets) {
          io.to(sid).emit("systemMessage", { text: "⚠️ Alle Nachrichten werden in Kürze gelöscht!", type: "error" });
          setTimeout(() => io.to(sid).emit("updateUsersAndMessages"), 1500);
        }
        return;
      }
      // userlist anzeigen
      if (finalContent === "/listUsers") {
          if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
      
          const users = Array.from(activeUsers.keys()).map(u => {
              const userRole = userRoles.get(u) || "user";
              const timeoutUntil = userTimeouts.get(u);
              const isMuted = timeoutUntil && timeoutUntil > Date.now();
              return `${u} - Rolle: ${userRole}${isMuted ? " (gemutet)" : ""}`;
          });
      
          socket.emit("systemMessage", {
              text: `ℹ️ Online-User:\n${users.join("\n")}`,
              type: "info"
          });
          return;
      }
      
      // /deleteAllUsers [passwort]
      if (finalContent.startsWith("/deleteAllUsers")) {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
        const provided = finalContent.split(" ")[1]?.trim();
        if (provided !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });

        try {
          const normalUsers = await User.find({ role: "user" }).select("username");
          const normalUsernames = normalUsers.map(u => u.username);

          const msgs = await Message.find({ sender: { $in: normalUsernames } }).select("_id");
          const msgIds = msgs.map(m => m._id.toString());
          if (msgIds.length) await Message.deleteMany({ _id: { $in: msgIds } });

          await User.deleteMany({ role: "user" });

          for (const uname of normalUsernames) {
            const socketsSet = activeUsers.get(uname);
            if (socketsSet && socketsSet.size) {
              for (const sid of socketsSet) {
                io.to(sid).emit("banned", { text: "Du wurdest entfernt (deleteAllUsers)." });
                const s = io.sockets.sockets.get(sid);
                if (s) try { s.disconnect(true); } catch {}
                authenticatedSockets.delete(sid);
              }
              activeUsers.delete(uname);
              userRoles.delete(uname);
              userFilters.delete(uname);
            }
          }

          emitToAdmins("adminNotice", { text: `${username} hat alle normalen Nutzer gelöscht.` });
          for (const sid of authenticatedSockets) {
            io.to(sid).emit("deletedMessages", msgIds);
            io.to(sid).emit("systemMessage", { text: "✅ Alle normalen Nutzer wurden gelöscht.", type: "ok" });
            setTimeout(() => io.to(sid).emit("updateUsersAndMessages"), 2000);
          }
        } catch (err) {
          console.error("deleteAllUsers Fehler:", err);
          socket.emit("systemMessage", { text: "Fehler beim Löschen der Nutzer.", type: "error" });
        }
        return;
      }

      // /reset [passwort]
      if (finalContent.startsWith("/reset")) {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
        const provided = finalContent.split(" ")[1]?.trim();
        if (provided !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
        await User.deleteMany({});
        userRoles.clear();
        activeUsers.clear();
        userFilters.clear();
        await Message.deleteMany({});
        io.emit("systemMessage", { text: "⚠️ Server wurde zurückgesetzt! Alles gelöscht.", type: "error" });
        io.emit("forceReload", true);
        return;
      }

      // /ban "username" ADMIN_PASS
      const banMatch = finalContent.match(/^\/ban\s+(?:"([^"]+)"|(\S+))\s+(\S+)/i);
      if (banMatch) {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });

        const target = (banMatch[1] || banMatch[2] || "").trim();
        const providedPass = banMatch[3];

        if (!target) return socket.emit("systemMessage", { text: "Benutzername fehlt.", type: "error" });
        if (providedPass !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Ungültiges Admin-Passwort für /ban.", type: "error" });
        if (normalize(target) === myNorm) return socket.emit("systemMessage", { text: "Du kannst dich nicht selbst bannen.", type: "error" });

        try {
          await User.findOneAndDelete({ username: target });
          const msgs = await Message.find({ sender: target }).select("_id");
          const msgIds = msgs.map(m => m._id.toString());
          if (msgIds.length) await Message.deleteMany({ _id: { $in: msgIds } });

          const socketsSet = findActiveSocketsFor(normalize(target));
          if (socketsSet && socketsSet.size) {
            for (const sid of socketsSet) {
              io.to(sid).emit("banned", { text: "Du wurdest vom Admin gebannt und entfernt." });
              const s = io.sockets.sockets.get(sid);
              if (s) try { s.disconnect(true); } catch {}
              authenticatedSockets.delete(sid);
            }
            // remove from activeUsers by matching key (case-insensitive)
            for (const uname of Array.from(activeUsers.keys())) {
              if (normalize(uname) === normalize(target)) activeUsers.delete(uname);
            }
            userRoles.delete(target);
            userFilters.delete(target);
          }

          for (const sid of authenticatedSockets) {
            io.to(sid).emit("deletedMessages", msgIds);
            io.to(sid).emit("systemMessage", {
              text: `⚠️ Nutzer "${target}" wurde gebannt und entfernt.`,
              type: "error",
            });
            setTimeout(() => io.to(sid).emit("updateUsersAndMessages"), 2000);
          }

          emitToAdmins("adminNotice", { text: `${username} hat ${target} gebannt.` });
        } catch (err) {
          console.error("Ban-Fehler:", err);
          socket.emit("systemMessage", { text: "Fehler beim Bannen des Nutzers.", type: "error" });
        }
        return;
      }

      // --- /timeout "username" DauerInSekunden ---
      const timeoutMatch = finalContent.match(/^\/timeout\s+(?:"([^"]+)"|(\S+))\s+(\d+)/i);
      if (timeoutMatch) {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
      
        const target = (timeoutMatch[1] || timeoutMatch[2] || "").trim();
        let durationSec = parseInt(timeoutMatch[3], 10);
        const MAX_TIMEOUT = 2592000; // 1 Std. : 3600 | 1 Tag : 86.400 | 7 Tage : 604.800 | 30 Tage: 2.592.000
      
        if (!target || isNaN(durationSec) || durationSec <= 0) {
          return socket.emit("systemMessage", { text: "Ungültiger Benutzername oder Dauer.", type: "error" });
        }
        if (durationSec > MAX_TIMEOUT) durationSec = MAX_TIMEOUT; // Limit setzen
        if (target === username) return socket.emit("systemMessage", { text: "Du kannst dich nicht selbst timeouten.", type: "error" });
      
        // Helper: Zeit formatieren
       function formatDuration(seconds) {
          const days = Math.floor(seconds / 86400);
          seconds %= 86400;
          const hours = Math.floor(seconds / 3600);
          seconds %= 3600;
          const minutes = Math.floor(seconds / 60);
          seconds %= 60;
          
          const parts = [];
          if (days) parts.push(`${days} Tag${days === 1 ? '' : 'e'}`);
          if (hours) parts.push(`${hours} Stunde${hours === 1 ? '' : 'n'}`);
          if (minutes) parts.push(`${minutes} Minute${minutes === 1 ? '' : 'n'}`);
          if (seconds) parts.push(`${seconds} Sekunde${seconds === 1 ? '' : 'n'}`);
          
          return parts.join(' ');
        }
      
        userTimeouts.set(target, Date.now() + durationSec * 1000);
        setTimeout(() => userTimeouts.delete(target), durationSec * 1000);
      
        const socketsSet = activeUsers.get(target);
        if (socketsSet && socketsSet.size) {
          for (const sid of socketsSet) {
            io.to(sid).emit("systemMessage", { text: `⚠️ Du wurdest für ${formatDuration(durationSec)} gemutet.`, type: "error" });
          }
        }
      
        emitToAdmins("adminNotice", { text: `${target} wurde für ${formatDuration(durationSec)} gemutet.` });
        return;
      }

      // andere "/" commands hier...
      return;
    }

    // --- Normale Nachricht ---
    if (finalContent.length > 150) finalContent = finalContent.slice(0, 150);
    if (userFilters.get(username)) finalContent = filterMessage(finalContent);

    const msg = new Message({ sender: username, content: finalContent, senderRole: role });
    await msg.save();

    const deletedIds = await trimOldMessages(100);
    if (deletedIds.length) {
      for (const sid of authenticatedSockets) {
        io.to(sid).emit("deletedMessages", deletedIds);
      }
    }

    for (const sid of authenticatedSockets) {
      io.to(sid).emit("newMessage", {
        _id: msg._id.toString(),
        sender: msg.sender,
        content: msg.content,
        createdAt: msg.createdAt,
        senderRole: role,
        type: "user"
      });
    }
  });

  socket.on("toggleFilter", (active) => {
    if (!username) return;
    userFilters.set(username, !!active);
  });
};
