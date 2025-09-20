// sockets/handlers/chatMessageHandler.js
const jwt = require("jsonwebtoken");
const Message = require("../../models/Message");
const User = require("../../models/User");
const filterMessage = require("../../utils/filter");

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

  // Spam state across users:
  const spamPenalty = new Map(); // username -> extra ms penalty
  // Note: lastMessageTime is provided in ctx

  const MIN_INTERVAL = 650; // baseline 2s between messages
  const PENALTY_INCREMENT = 500; // additional 1s per spam attempt

  socket.on("chatMessage", async (content) => {
    if (!username) return;

    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    const now = Date.now();
    const last = lastMessageTime.get(username) || 0;
    const penalty = spamPenalty.get(username) || 0;
    const allowedAt = last + MIN_INTERVAL + penalty;
    
    // If not yet allowed:
    if (now < allowedAt) {
      const newPenalty = penalty + PENALTY_INCREMENT;
      spamPenalty.set(username, newPenalty);
      const newAllowedAt = last + MIN_INTERVAL + newPenalty;
      socket.emit("spamWarning", { allowedAt: newAllowedAt, message: "⚠️ Bitte nicht Nachrichten spammen." });

      // do not process message
      return;
    }
    spamPenalty.set(username, 0);
    lastMessageTime.set(username, now);

    let finalContent = (content || "").trim();

    // --- /role ---
    if (finalContent === "/role") {
      const r = userRoles.get(username) || dbUser?.role || "user";
      socket.emit("systemMessage", { text: `ℹ️ Deine Rolle ist: ${r}`, type: "info" });
      // clear any spam-warning, as user successfully interacted
      socket.emit("spamClear");
      return;
    }

    // --- /admin [passwort] ---
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

        // Rolle sofort für alle authentifizierten Clients aktualisieren
        for (const sid of authenticatedSockets) {
          io.to(sid).emit("roleUpdated", { username, role });
        }

        emitToAdmins("adminNotice", { text: `${username} ist jetzt Admin.` });
      } else {
        socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
      }
      socket.emit("spamClear");
      return;
    }

    // --- /help ---
    if (finalContent === "/help") {
      socket.emit("systemMessage", {
        text: `Verfügbare Befehle:
        /admin [passwort] - Admin werden
        /clear - Chat leeren (Admins)
        /deleteAllUsers [passwort] - Alle normalen User löschen
        /reset [passwort] - Server zurücksetzen
        /ban "username" ADMIN_PASS - User bannen
        /role - Zeigt deine aktuelle Rolle
        /help - Zeigt diese Nachricht`,
        type: "info",
        duration: 10000
      });
      socket.emit("spamClear");
      return;
    }

    // --- /clear ---
    if (finalContent === "/clear") {
      if (role !== "admin") {
        socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
        socket.emit("spamClear");
        return;
      }
      await Message.deleteMany({});
      // notify authenticated clients to clear messages & reload
      for (const sid of authenticatedSockets) {
        io.to(sid).emit("deletedMessages", []); // clients empty chat
        io.to(sid).emit("systemMessage", { text: "⚠️ Alle Nachrichten gelöscht.", type: "error" });
        io.to(sid).emit("updateUsersAndMessages");
      }
      socket.emit("spamClear");
      return;
    }

    // --- /deleteAllUsers [passwort] ---
    if (finalContent.startsWith("/deleteAllUsers")) {
      if (role !== "admin") {
        socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
        socket.emit("spamClear");
        return;
      }
      const provided = finalContent.split(" ")[1]?.trim();
      if (provided !== ADMIN_PASS) {
        socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
        socket.emit("spamClear");
        return;
      }

      try {
        const normalUsers = await User.find({ role: "user" }).select("username");
        const normalUsernames = normalUsers.map(u => u.username);

        // delete messages of normal users
        const msgs = await Message.find({ sender: { $in: normalUsernames } }).select("_id");
        const msgIds = msgs.map(m => m._id.toString());
        if (msgIds.length) await Message.deleteMany({ _id: { $in: msgIds } });

        // delete users
        await User.deleteMany({ role: "user" });

        // kick/notify deleted users if online
        for (const uname of normalUsernames) {
          const socketsSet = activeUsers.get(uname);
          if (socketsSet && socketsSet.size) {
            for (const sid of socketsSet) {
              io.to(sid).emit("banned", { text: "Du wurdest entfernt (deleteAllUsers)." });
              const s = io.sockets.sockets.get(sid);
              if (s) {
                try { s.disconnect(true); } catch (e) {}
              }
              authenticatedSockets.delete(sid);
            }
            activeUsers.delete(uname);
            userRoles.delete(uname);
            userFilters.delete(uname);
          }
        }

        // notify remaining authenticated clients
        for (const sid of authenticatedSockets) {
          io.to(sid).emit("deletedMessages", msgIds);
          io.to(sid).emit("systemMessage", { text: "✅ Alle normalen Nutzer wurden gelöscht.", type: "ok" });
          io.to(sid).emit("updateUsersAndMessages");
        }

        emitToAdmins("adminNotice", { text: `${username} hat alle normalen Nutzer gelöscht.` });
      } catch (err) {
        console.error("deleteAllUsers Fehler:", err);
        socket.emit("systemMessage", { text: "Fehler beim Löschen der Nutzer.", type: "error" });
      }
      socket.emit("spamClear");
      return;
    }

    // --- /reset ---
    if (finalContent.startsWith("/reset")) {
      if (role !== "admin") {
        socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
        socket.emit("spamClear");
        return;
      }
      const provided = finalContent.split(" ")[1]?.trim();
      if (provided !== ADMIN_PASS) {
        socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
        socket.emit("spamClear");
        return;
      }
      await User.deleteMany({});
      userRoles.clear();
      activeUsers.clear();
      userFilters.clear();
      await Message.deleteMany({});
      io.emit("systemMessage", { text: "⚠️ Server wurde zurückgesetzt! Alles gelöscht.", type: "error" });
      io.emit("forceReload", true);
      socket.emit("spamClear");
      return;
    }

    // --- /ban "username" ADMIN_PASS ---
    {
      const banMatch = finalContent.match(/^\/ban\s+(?:"([^"]+)"|(\S+))\s+(\S+)/i);
      if (banMatch) {
        if (role !== "admin") {
          socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
          socket.emit("spamClear");
          return;
        }

        const target = (banMatch[1] || banMatch[2] || "").trim();
        const providedPass = banMatch[3];

        if (!target) {
          socket.emit("systemMessage", { text: "Benutzername fehlt.", type: "error" });
          socket.emit("spamClear");
          return;
        }
        if (providedPass !== ADMIN_PASS) {
          socket.emit("systemMessage", { text: "Ungültiges Admin-Passwort für /ban.", type: "error" });
          socket.emit("spamClear");
          return;
        }
        if (target === username) {
          socket.emit("systemMessage", { text: "Du kannst dich nicht selbst bannen.", type: "error" });
          socket.emit("spamClear");
          return;
        }

        try {
          // delete user & their messages
          await User.findOneAndDelete({ username: target });
          const msgs = await Message.find({ sender: target }).select("_id");
          const msgIds = msgs.map(m => m._id.toString());
          if (msgIds.length) await Message.deleteMany({ _id: { $in: msgIds } });

          // kick active sessions
          const socketsSet = activeUsers.get(target);
          if (socketsSet && socketsSet.size) {
            for (const sid of socketsSet) {
              io.to(sid).emit("banned", { text: "Du wurdest vom Admin gebannt und entfernt." });
              const s = io.sockets.sockets.get(sid);
              if (s) try { s.disconnect(true); } catch {}
              authenticatedSockets.delete(sid);
            }
            activeUsers.delete(target);
            userRoles.delete(target);
            userFilters.delete(target);
          }

          // notify remaining authenticated clients to remove messages & refresh
          for (const sid of authenticatedSockets) {
            io.to(sid).emit("deletedMessages", msgIds);
            io.to(sid).emit("systemMessage", { text: `⚠️ Nutzer "${target}" wurde gebannt und entfernt.`, type: "error" });
            io.to(sid).emit("updateUsersAndMessages");
          }

          emitToAdmins("adminNotice", { text: `${username} hat ${target} gebannt.` });
        } catch (err) {
          console.error("Ban-Fehler:", err);
          socket.emit("systemMessage", { text: "Fehler beim Bannen des Nutzers.", type: "error" });
        }
        socket.emit("spamClear");
        return;
      }
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

    // send only to authenticated sockets
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

    // clear any spam-warning on the sender socket
    socket.emit("spamClear");
  });

  socket.on("toggleFilter", (active) => {
    if (!username) return;
    userFilters.set(username, !!active);
  });
};
