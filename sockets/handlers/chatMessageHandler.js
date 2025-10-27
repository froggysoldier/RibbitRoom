// sockets/handlers/chatMessageHandler.js
const jwt = require("jsonwebtoken");
const Message = require("../../models/Message");
const User = require("../../models/User");
const filterMessage = require("../../utils/filter");

module.exports = function (socket, ctx) {
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
    io,
  } = ctx;

  // Hilfsfunktionen
  const normalize = (u) => String(u || "").trim().toLowerCase();

  // Globale Maps auf ctx
  ctx.messageHistory = ctx.messageHistory || new Map();
  const messageHistory = ctx.messageHistory;

  // Hilfsfunktion: finde aktive Sockets für Username
  const findActiveSocketsFor = (targetNorm) => {
    for (const [uname, socketsSet] of activeUsers.entries()) {
      if (normalize(uname) === targetNorm) return socketsSet;
    }
    return null;
  };

  // Hilfsfunktion: Dauer formatieren
  const formatDuration = (seconds) => {
    seconds = Math.max(0, Math.floor(seconds));
    if (seconds < 60) return `${seconds} Sekunde${seconds === 1 ? "" : "n"}`;
    const days = Math.floor(seconds / 86400);
    seconds %= 86400;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    seconds %= 60;
    const parts = [];
    if (days) parts.push(`${days} Tag${days === 1 ? "" : "e"}`);
    if (hours) parts.push(`${hours} Stunde${hours === 1 ? "" : "n"}`);
    if (minutes) parts.push(`${minutes} Minute${minutes === 1 ? "" : "n"}`);
    if (seconds) parts.push(`${seconds} Sekunde${seconds === 1 ? "" : "n"}`);
    return parts.join(" ");
  };

  // --- Chat-Message Handler ---
  socket.on("chatMessage", async (content) => {
    if (!username) return;

    const now = Date.now();
    const myNorm = normalize(username);

    // --- Minimaler Zeitabstand zwischen Nachrichten ---
    const MIN_INTERVAL = 350; // ms
    const lastTime = lastMessageTime.get(username) || 0;
    if (now - lastTime < MIN_INTERVAL) {
      lastMessageTime.set(username, now);
      return socket.emit("systemMessage", { text: "⚠️ Bitte keine Nachrichten spammen.", type: "error", duration: 1500 });
    }
    lastMessageTime.set(username, now);

    // --- Spam-History (nur Warnung, kein Auto-Timeout) ---
    const HISTORY_LIMIT = 7;
    const TIME_WINDOW = 10000; // ms
    const hist = messageHistory.get(myNorm) || [];
    const recent = hist.filter((ts) => now - ts <= TIME_WINDOW);
    recent.push(now);
    messageHistory.set(myNorm, recent);
    if (recent.length > HISTORY_LIMIT) {
      socket.emit("systemMessage", {
        text: "⚠️ Du sendest zu schnell Nachrichten. Bitte warte kurz.",
        type: "error",
        duration: 4000,
      });
      return;
    }

    // --- DB-User & Rolle ---
    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    let finalContent = (content || "").trim();

    // --- Befehle ---
    if (finalContent.startsWith("/")) {
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
ℹ️ Befehle:
• /admin [passwort]                       → Admin werden
• /ban "username" [passwort]             → User bannen
• /clear                                 → Chat leeren (Admins)
• /deleteAllUsers [passwort]             → Alle normalen User löschen
• /reset [passwort]                      → Server zurücksetzen
• /role                                  → Zeigt deine aktuelle Rolle
• /help                                  → Zeigt diese Nachricht
          `.trim(),
          type: "info",
          duration: 15000,
        });
        return;
      }

      // /admin
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
          io.to(sid).emit("systemMessage", { text: "⚠️ Alle Nachrichten werden gelöscht!", type: "error" });
          setTimeout(() => io.to(sid).emit("updateUsersAndMessages"), 1500);
        }
        return;
      }

      // /deleteAllUsers
      if (finalContent.startsWith("/deleteAllUsers")) {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
        const provided = finalContent.split(" ")[1]?.trim();
        if (provided !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });

        try {
          const normalUsers = await User.find({ role: "user" }).select("username");
          const normalUsernames = normalUsers.map((u) => u.username);
          const msgs = await Message.find({ sender: { $in: normalUsernames } }).select("_id");
          const msgIds = msgs.map((m) => m._id.toString());
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

      // /reset
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

      // /ban
      const banMatch = finalContent.match(/^\/ban\s+(?:"([^"]+)"|(\S+))\s+(\S+)/i);
      if (banMatch) {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
        const targetRaw = (banMatch[1] || banMatch[2] || "").trim();
        const providedPass = banMatch[3];
        if (!targetRaw) return socket.emit("systemMessage", { text: "Benutzername fehlt.", type: "error" });
        if (providedPass !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Ungültiges Admin-Passwort für /ban.", type: "error" });
        if (normalize(targetRaw) === myNorm) return socket.emit("systemMessage", { text: "Du kannst dich nicht selbst bannen.", type: "error" });

        try {
          await User.findOneAndDelete({ username: targetRaw });
          const msgs = await Message.find({ sender: targetRaw }).select("_id");
          const msgIds = msgs.map((m) => m._id.toString());
          if (msgIds.length) await Message.deleteMany({ _id: { $in: msgIds } });

          const socketsSet = findActiveSocketsFor(normalize(targetRaw));
          if (socketsSet && socketsSet.size) {
            for (const sid of socketsSet) {
              io.to(sid).emit("banned", { text: "Du wurdest vom Admin gebannt und entfernt." });
              const s = io.sockets.sockets.get(sid);
              if (s) try { s.disconnect(true); } catch {}
              authenticatedSockets.delete(sid);
            }
            for (const uname of Array.from(activeUsers.keys())) {
              if (normalize(uname) === normalize(targetRaw)) activeUsers.delete(uname);
            }
            userRoles.delete(targetRaw);
            userFilters.delete(targetRaw);
          }

          for (const sid of authenticatedSockets) {
            io.to(sid).emit("deletedMessages", msgIds);
            io.to(sid).emit("systemMessage", { text: `⚠️ Nutzer "${targetRaw}" wurde gebannt und entfernt.`, type: "error" });
            setTimeout(() => io.to(sid).emit("updateUsersAndMessages"), 2000);
          }

          emitToAdmins("adminNotice", { text: `${username} hat ${targetRaw} gebannt.` });
        } catch (err) {
          console.error("Ban-Fehler:", err);
          socket.emit("systemMessage", { text: "Fehler beim Bannen des Nutzers.", type: "error" });
        }
        return;
      }

      // unbekanntes Kommando
      socket.emit("systemMessage", { text: `ℹ️ Unbekanntes Kommando: ${finalContent}`, type: "info" });
      return;
    }

    

    // --- Normale Nachricht ---
    if (finalContent.length > 150) finalContent = finalContent.slice(0, 150);
    if (userFilters.get(username)) finalContent = filterMessage(finalContent);

    try {
      const msg = new Message({ sender: username, content: finalContent, senderRole: role });
      await msg.save();

      const deletedIds = await trimOldMessages(100);
      if (deletedIds.length) {
        for (const sid of authenticatedSockets) io.to(sid).emit("deletedMessages", deletedIds);
      }

      for (const sid of authenticatedSockets) {
        io.to(sid).emit("newMessage", {
          _id: msg._id.toString(),
          sender: msg.sender,
          content: msg.content,
          createdAt: msg.createdAt,
          senderRole: role,
          type: "user",
        });
      }
    } catch (err) {
      console.error("Message-Fehler:", err);
      socket.emit("systemMessage", { text: "Fehler beim Senden der Nachricht.", type: "error" });
    }
  });

  socket.on("toggleFilter", (active) => {
    if (!username) return;
    userFilters.set(username, !!active);
  });
};
