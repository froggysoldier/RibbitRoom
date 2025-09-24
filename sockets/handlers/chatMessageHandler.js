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

  // Ensure server-wide maps on ctx (normalized keys)
  ctx.userTimeouts = ctx.userTimeouts || new Map();           // normalizedUsername -> timestamp(ms)
  ctx.messageHistory = ctx.messageHistory || new Map();       // normalizedUsername -> [timestamps(ms)]
  ctx.userTimeoutIntervals = ctx.userTimeoutIntervals || new Map(); // normalizedUsername -> Map(socketId -> intervalId)

  const userTimeouts = ctx.userTimeouts;
  const messageHistory = ctx.messageHistory;
  const userTimeoutIntervals = ctx.userTimeoutIntervals;

  // Helpers
  const normalize = (u) => String(u || "").trim().toLowerCase();

  // find active sockets set for a username (case-insensitive) -> returns Set of socketIds or null
  const findActiveSocketsFor = (targetNorm) => {
    for (const [uname, socketsSet] of activeUsers.entries()) {
      if (normalize(uname) === targetNorm) return socketsSet;
    }
    return null;
  };

  // human readable duration
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

  /**
   * Start a timeout for a user (normalized internally). This:
   * - sets userTimeouts[targetNorm]
   * - clears existing intervals for that user
   * - creates per-socket intervals that emit "timeoutUpdate" every second
   * - when finished emits final message and clears intervals/map
   *
   * @param {string} targetRaw  original username (will be normalized)
   * @param {number} durationSec seconds
   * @param {string} initiatedBy optional info (unused for logic, useful for logs)
   */
  const startTimeoutForUser = (targetRaw, durationSec, initiatedBy = '') => {
    const targetNorm = normalize(targetRaw);
    const timeoutUntil = Date.now() + Math.max(0, Math.floor(durationSec)) * 1000;
    userTimeouts.set(targetNorm, timeoutUntil);

    // clear old intervals
    const prevMap = userTimeoutIntervals.get(targetNorm);
    if (prevMap) {
      for (const id of prevMap.values()) {
        try { clearInterval(id); } catch (e) { /* ignore */ }
      }
      userTimeoutIntervals.delete(targetNorm);
    }

    // prepare new map
    const intervalsMap = new Map();
    userTimeoutIntervals.set(targetNorm, intervalsMap);

    // id for client message
    const timeoutMsgId = `timeout-${targetNorm}`;

    // find active sockets (case-insensitive)
    const socketsSet = findActiveSocketsFor(targetNorm);

    // If sockets exist: notify each socket and create per-socket interval
    if (socketsSet && socketsSet.size) {
      for (const sid of socketsSet) {
        const socketTarget = io.sockets.sockets.get(sid);
        if (!socketTarget) continue;

        // initial emit
        try {
          socketTarget.emit("timeoutUpdate", {
            id: timeoutMsgId,
            text: `⚠️ Du bist gemutet für ${formatDuration(durationSec)}.`,
            remaining: durationSec
          });
        } catch (e) {
          // ignore
        }

        // per-socket interval
        const intervalId = setInterval(() => {
          const until = userTimeouts.get(targetNorm) || 0;
          const remaining = Math.ceil((until - Date.now()) / 1000);

          if (remaining <= 0) {
            try {
              socketTarget.emit("timeoutUpdate", {
                id: timeoutMsgId,
                text: "✔️ Du kannst wieder schreiben.",
                remaining: 0
              });
            } catch (e) { /* ignore */ }

            // clear this interval and cleanup maps
            try { clearInterval(intervalId); } catch (e) {}
            const m = userTimeoutIntervals.get(targetNorm);
            if (m) {
              m.delete(sid);
              if (m.size === 0) userTimeoutIntervals.delete(targetNorm);
            }
            // If no more intervals remain for this user, remove the userTimeouts key
            if (!userTimeoutIntervals.has(targetNorm)) {
              userTimeouts.delete(targetNorm);
            }
            return;
          }

          // regular update
          try {
            socketTarget.emit("timeoutUpdate", {
              id: timeoutMsgId,
              text: `⚠️ Du bist noch für ${formatDuration(remaining)} gemutet.`,
              remaining
            });
          } catch (e) { /* ignore */ }
        }, 1000);

        intervalsMap.set(sid, intervalId);
      }
    } else {
      // user offline right now: we still keep userTimeouts entry so server-side checks block sending,
      // and when user reconnects they will not be able to send until timeout expires.
      // No interval is created because no socket to push updates to.
    }

    // reset spam history for that user
    messageHistory.set(targetNorm, []);
  };

  socket.on("chatMessage", async (content) => {
    if (!username) return;

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
      return;
    }

    // --- Minimaler Zeitabstand zwischen zwei Nachrichten (anti-flood) ---
    const MIN_INTERVAL = 600; // ms, z.B. 600ms
    const lastTime = lastMessageTime.get(username) || 0;
    if (now - lastTime < MIN_INTERVAL) {
      lastMessageTime.set(username, now); // update to slow down attempts
      return socket.emit("systemMessage", { text: "⚠️ Bitte keine Nachrichten spammen.", type: "error", duration: 2500 });
    }
    lastMessageTime.set(username, now);

    // --- Spam: max. 5 Nachrichten / 10 Sekunden (server-side) ---
    const HISTORY_LIMIT = 5;
    const TIME_WINDOW = 10000; // ms
    const SPAM_TIMEOUT = 30; // seconds (auto-mute)

    const hist = messageHistory.get(myNorm) || [];
    const recent = hist.filter(ts => now - ts <= TIME_WINDOW);
    recent.push(now);
    messageHistory.set(myNorm, recent);

    if (recent.length > HISTORY_LIMIT) {
      // automatic timeout for this user
      startTimeoutForUser(username, SPAM_TIMEOUT, 'spam-auto');
      // Inform initiating socket (instant feedback)
      socket.emit("systemMessage", {
        text: `⚠️ Zu viele Nachrichten! Du wurdest automatisch für ${SPAM_TIMEOUT} Sekunden gemutet.`,
        type: "error",
        duration: 6000
      });
      return;
    }

    // --- Load DB user & role (needed for commands) ---
    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    let finalContent = (content || "").trim();

    // --- Commands (startsWith "/") ---
    if (finalContent.startsWith("/")) {
      // /role
      if (finalContent === "/role") {
        const r = userRoles.get(username) || dbUser?.role || "user";
        socket.emit("systemMessage", { text: `ℹ️ Deine Rolle ist: ${r}`, type: "info" });
        return;
      }

      // /help (nicely formatted)
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

      // /timeout "username" DauerInSekunden (Admin)
      const timeoutMatch = finalContent.match(/^\/timeout\s+(?:"([^"]+)"|(\S+))\s+(\d+)/i);
      if (timeoutMatch) {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });

        const targetRaw = (timeoutMatch[1] || timeoutMatch[2] || "").trim();
        let durationSec = parseInt(timeoutMatch[3], 10);
        const MAX_TIMEOUT = 604800; // 7 Tage

        if (!targetRaw || isNaN(durationSec) || durationSec <= 0) {
          return socket.emit("systemMessage", { text: "Ungültiger Benutzername oder Dauer.", type: "error" });
        }
        if (durationSec > MAX_TIMEOUT) durationSec = MAX_TIMEOUT;
        if (normalize(targetRaw) === myNorm) return socket.emit("systemMessage", { text: "Du kannst dich nicht selbst timeouten.", type: "error" });

        // start timeout for target user (handles per-socket intervals)
        startTimeoutForUser(targetRaw, durationSec, `admin:${username}`);

        // notify any online sockets of the target (startTimeoutForUser already sends timeoutUpdate)
        emitToAdmins("adminNotice", { text: `${targetRaw} wurde für ${formatDuration(durationSec)} gemutet.` });
        return;
      }

      // unknown command -> last
      if (finalContent.startsWith("/")) {
        const knownCommands = ["/role", "/help", "/admin", "/clear", "/deleteAllUsers", "/reset", "/ban", "/timeout", "/listUsers"];
        const isKnown = knownCommands.some(cmd => finalContent.startsWith(cmd));
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

    try {
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
    } catch (err) {
      console.error("Fehler beim Speichern/Senden der Nachricht:", err);
      socket.emit("systemMessage", { text: "Fehler beim Senden der Nachricht.", type: "error" });
    }
  });

  socket.on("toggleFilter", (active) => {
    if (!username) return;
    userFilters.set(username, !!active);
  });
};
