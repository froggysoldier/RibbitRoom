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
    io
  } = ctx;

  // ensure server-wide maps on ctx (use normalized usernames as keys)
  ctx.userTimeouts = ctx.userTimeouts || new Map();         // normalizedUsername -> timestamp(ms)
  ctx.messageHistory = ctx.messageHistory || new Map();     // normalizedUsername -> [timestamps]
  ctx.userTimeoutIntervals = ctx.userTimeoutIntervals || new Map(); // normalizedUsername -> Set(intervalIds)

  const userTimeouts = ctx.userTimeouts;
  const messageHistory = ctx.messageHistory;
  const userTimeoutIntervals = ctx.userTimeoutIntervals;

  // Helpers
  const normalize = (u) => String(u || "").trim().toLowerCase();

  // find active sockets set for a username (case-insensitive) -> returns Set or null
  const findActiveSocketsFor = (targetNorm) => {
    for (const [uname, socketsSet] of activeUsers.entries()) {
      if (normalize(uname) === targetNorm) return socketsSet;
    }
    return null;
  };

  // nice duration formatter (sec -> human readable)
  const formatDuration = (seconds) => {
    seconds = Math.max(0, Math.floor(seconds));
    if (seconds < 60) return `${seconds} Sekunde${seconds === 1 ? '' : 'n'}`;
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
  };

  socket.on("chatMessage", async (content) => {
    if (!username) return;

    // --- Load DB user & role early ---
    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    const now = Date.now();
    const myNorm = normalize(username);

    // --- Prüfen ob gemutet (normalized) ---
    const timeoutUntil = userTimeouts.get(myNorm);
    if (timeoutUntil && now < timeoutUntil) {
      const remainingSec = Math.ceil((timeoutUntil - now) / 1000);
      socket.emit("systemMessage", {
        text: remainingSec < 60
          ? `⚠️ Du bist noch für ${remainingSec} Sekunde${remainingSec === 1 ? '' : 'n'} gemutet.`
          : `⚠️ Du bist noch für ${formatDuration(remainingSec)} gemutet.`,
        type: "error",
        duration: Math.min(60000, (timeoutUntil - now))
      });
      return; // stop further processing
    }

    // --- Anti-Spam: max. 5 messages / 10s (server-side) ---
    const HISTORY_LIMIT = 5;
    const TIME_WINDOW = 10000; // ms
    const SPAM_TIMEOUT = 30; // seconds

    const hist = messageHistory.get(myNorm) || [];
    const recent = hist.filter(ts => now - ts <= TIME_WINDOW);
    recent.push(now);
    messageHistory.set(myNorm, recent);

    if (recent.length > HISTORY_LIMIT) {
      const until = now + SPAM_TIMEOUT * 1000;
      userTimeouts.set(myNorm, until);

      // clear existing intervals for this user (if any)
      const oldSet = userTimeoutIntervals.get(myNorm);
      if (oldSet) {
        for (const id of oldSet) clearInterval(id);
        userTimeoutIntervals.delete(myNorm);
      }

      // reset history so user doesn't immediately retrigger
      messageHistory.set(myNorm, []);

      socket.emit("systemMessage", {
        text: `⚠️ Zu viele Nachrichten! Du wurdest automatisch für ${SPAM_TIMEOUT} Sekunden gemutet.`,
        type: "error",
        duration: 6000
      });
      return;
    }

    let finalContent = (content || "").trim();

    // --- Commands (startsWith "/") ---
    if (finalContent.startsWith("/")) {
      // list of known commands (used at the end for unknown command)
      const knownCommands = [
        "/role", "/help", "/admin", "/clear", "/deleteAllUsers",
        "/reset", "/ban", "/timeout", "/listUsers"
      ];

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
• /timeout "username" DauerInSekunden    → User temporär muten (Admins)
• /listUsers                             → Liste der Online-User (Admins)
• /help                                  → Zeigt diese Nachricht
          `.trim(),
          type: "info",
          duration: 15000
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
          io.to(sid).emit("systemMessage", { text: "⚠️ Alle Nachrichten werden in Kürze gelöscht!", type: "error" });
          setTimeout(() => io.to(sid).emit("updateUsersAndMessages"), 1500);
        }
        return;
      }

      // /listUsers
      if (finalContent === "/listUsers") {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });

        const users = Array.from(activeUsers.keys()).map(u => {
          const uNorm = normalize(u);
          const userRole = userRoles.get(u) || "user";
          const timeoutUntil = userTimeouts.get(uNorm);
          const isMuted = timeoutUntil && timeoutUntil > Date.now();
          return `${u} - Rolle: ${userRole}${isMuted ? " (gemutet)" : ""}`;
        });

        socket.emit("systemMessage", {
          text: `ℹ️ Online-User:\n${users.join("\n")}`,
          type: "info",
          duration: 15000
        });
        return;
      }

      // /deleteAllUsers
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

      // /ban "username" ADMIN_PASS
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
          const msgIds = msgs.map(m => m._id.toString());
          if (msgIds.length) await Message.deleteMany({ _id: { $in: msgIds } });

          const socketsSet = findActiveSocketsFor(normalize(targetRaw));
          if (socketsSet && socketsSet.size) {
            for (const sid of socketsSet) {
              io.to(sid).emit("banned", { text: "Du wurdest vom Admin gebannt und entfernt." });
              const s = io.sockets.sockets.get(sid);
              if (s) try { s.disconnect(true); } catch {}
              authenticatedSockets.delete(sid);
            }
            // remove from activeUsers by matching key (case-insensitive)
            for (const uname of Array.from(activeUsers.keys())) {
              if (normalize(uname) === normalize(targetRaw)) activeUsers.delete(uname);
            }
            userRoles.delete(targetRaw);
            userFilters.delete(targetRaw);
          }

          for (const sid of authenticatedSockets) {
            io.to(sid).emit("deletedMessages", msgIds);
            io.to(sid).emit("systemMessage", {
              text: `⚠️ Nutzer "${targetRaw}" wurde gebannt und entfernt.`,
              type: "error",
            });
            setTimeout(() => io.to(sid).emit("updateUsersAndMessages"), 2000);
          }

          emitToAdmins("adminNotice", { text: `${username} hat ${targetRaw} gebannt.` });
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

        const targetRaw = (timeoutMatch[1] || timeoutMatch[2] || "").trim();
        const targetNorm = normalize(targetRaw);
        let durationSec = parseInt(timeoutMatch[3], 10);
        const MAX_TIMEOUT = 604800; // 7 Tage

        if (!targetRaw || isNaN(durationSec) || durationSec <= 0) {
          return socket.emit("systemMessage", { text: "Ungültiger Benutzername oder Dauer.", type: "error" });
        }
        if (durationSec > MAX_TIMEOUT) durationSec = MAX_TIMEOUT;
        if (targetNorm === myNorm) return socket.emit("systemMessage", { text: "Du kannst dich nicht selbst timeouten.", type: "error" });

        const timeoutUntilTime = Date.now() + durationSec * 1000;
        userTimeouts.set(targetNorm, timeoutUntilTime);

        // clear existing intervals for this user (if any)
        const oldSet = userTimeoutIntervals.get(targetNorm);
        if (oldSet) {
          for (const id of oldSet) clearInterval(id);
        }
        userTimeoutIntervals.set(targetNorm, new Set());

        const timeoutMsgId = `timeout-${targetNorm}`;

        // notify all sockets of that user and create per-socket intervals
        const socketsSet = findActiveSocketsFor(targetNorm);
        if (socketsSet && socketsSet.size) {
          for (const sid of socketsSet) {
            const socketTarget = io.sockets.sockets.get(sid);
            if (!socketTarget) continue;

            // initial message (with id)
            socketTarget.emit("timeoutUpdate", {
              id: timeoutMsgId,
              text: `⚠️ Du bist gemutet für ${formatDuration(durationSec)}.`,
              remaining: durationSec
            });

            // per-socket countdown interval
            const intervalId = setInterval(() => {
              const remaining = Math.ceil((userTimeouts.get(targetNorm) - Date.now()) / 1000);

              if (remaining <= 0) {
                clearInterval(intervalId);
                // remove intervalId from set
                const sset = userTimeoutIntervals.get(targetNorm);
                if (sset) sset.delete(intervalId);
                if (!sset || sset.size === 0) userTimeoutIntervals.delete(targetNorm);
                userTimeouts.delete(targetNorm);

                socketTarget.emit("timeoutUpdate", {
                  id: timeoutMsgId,
                  text: "✔️ Du kannst wieder schreiben.",
                  remaining: 0
                });
                return;
              }

              socketTarget.emit("timeoutUpdate", {
                id: timeoutMsgId,
                text: `⚠️ Du bist noch für ${formatDuration(remaining)} gemutet.`,
                remaining
              });
            }, 1000);

            // save interval
            userTimeoutIntervals.get(targetNorm).add(intervalId);
          }
        }

        // reset message history for that user (normalized key)
        messageHistory.set(targetNorm, []);

        emitToAdmins("adminNotice", { text: `${targetRaw} wurde für ${formatDuration(durationSec)} gemutet.` });
        return;
      }

      // Unknown command handling (last)
      if (finalContent.startsWith("/")) {
        const knownCommands2 = ["/role", "/help", "/admin", "/clear", "/deleteAllUsers", "/reset", "/ban", "/timeout", "/listUsers"];
        const isKnown = knownCommands2.some(cmd => finalContent.startsWith(cmd));
        if (!isKnown) {
          socket.emit("systemMessage", { text: `ℹ️ Unbekanntes Kommando: ${finalContent}`, type: "info" });
          return;
        }
      }

      return;
    } // end if startsWith("/")

    // --- Normal message flow ---
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
