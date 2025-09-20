// sockets/handlers/chatMessageHandler.js
const jwt = require("jsonwebtoken");
const Message = require("../../models/Message");
const User = require("../../models/User");
const filterMessage = require("../../utils/filter");

module.exports = function(socket, ctx) {
  let {
    io,
    activeUsers,
    userRoles,
    userFilters,
    lastMessageTime,
    trimOldMessages,
    emitToAdmins,
    authenticatedSockets,
    JWT_SECRET,
    ADMIN_PASS
  } = ctx;

  const spamWarningShown = new Map();

  socket.on("chatMessage", async (content) => {
    if (!socket.username) return; // only authenticated sockets may send
    const username = socket.username;

    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    // --- Anti-Spam: nur alle 2 Sekunden ---
    const now = Date.now();
    const lastTime = lastMessageTime.get(username) || 0;
    const diff = now - lastTime;

    if (diff < 700) {
      // show spam warning once while spamming; subsequent spam extends wait
      if (!spamWarningShown.get(username)) {
        socket.emit("systemMessage", { text: "⚠️ Bitte nicht Nachrichten spammen.", type: "error", duration: 700 });
        spamWarningShown.set(username, true);
      }
      // extend the lastMessageTime so further spam pushes the timer forward
      lastMessageTime.set(username, now);
      return;
    } else {
      spamWarningShown.set(username, false);
    }
    lastMessageTime.set(username, now);

    let finalContent = (content || "").trim();

    // --- /role ---
    if (finalContent === "/role") {
      const r = userRoles.get(username) || dbUser?.role || "user";
      socket.emit("systemMessage", { text: `ℹ️ Deine Rolle ist: ${r}`, type: "info"});
      return;
    }

    // --- /help ---
    if (finalContent === "/help") {
      socket.emit("systemMessage", {
        text: `/admin [passwort] - Admin werden
/ban "username" ADMIN_PASS - User bannen
/clear - Chat leeren (Admins)
/deleteAllUsers [passwort] - Alle normalen User löschen
/reset [passwort] - Server zurücksetzen
/role - Zeigt deine aktuelle Rolle
/help - Zeigt diese Nachricht`,
        type: "info",
        duration: 10000
      });
      return;
    }

    // --- /admin [passwort] ---
    const adminMatch = finalContent.match(/^\/admin\s*(?:[:]\s*)?(.*)$/i);
    if (adminMatch) {
      const provided = (adminMatch[1] || "").trim();
      if (provided && provided === ADMIN_PASS) {
        if (dbUser) { dbUser.role = "admin"; await dbUser.save(); }
        role = "admin";
        userRoles.set(username, role);

        const newToken = jwt.sign({ username, role }, JWT_SECRET, { expiresIn: "7d" });
        socket.emit("newToken", { token: newToken });

        socket.emit("systemMessage", { text: "✔️ Du bist jetzt Admin.", type: "ok", duration: 4000 });

        // update role for all authenticated sockets
        for (const sid of authenticatedSockets) {
          io.to(sid).emit("roleUpdated", { username, role });
        }

        emitToAdmins("adminNotice", { text: `${username} ist jetzt Admin.` });
      } else {
        socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error", duration: 4000 });
      }
      return;
    }

    // --- /clear ---
    if (finalContent === "/clear") {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error", duration: 4000 });

      // delete user messages
      await Message.deleteMany({ type: "user" });

      // notify authenticated clients: clear chat + refresh
      for (const sid of authenticatedSockets) {
        io.to(sid).emit("deletedMessages", []);
        io.to(sid).emit("systemMessage", { text: "⚠️ Alle Nachrichten gelöscht.", type: "error", duration: 4000 });
        io.to(sid).emit("updateUsersAndMessages");
      }
      return;
    }

    // --- /deleteAllUsers [passwort] ---
    if (finalContent.startsWith("/deleteAllUsers")) {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error", duration: 4000 });
      const provided = finalContent.split(" ")[1]?.trim();
      if (provided !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error", duration: 4000 });

      try {
        const normalUsers = await User.find({ role: "user" }).select("username");
        const normalUsernames = normalUsers.map(u => u.username);

        // delete user messages (only user-type)
        const msgs = await Message.find({ sender: { $in: normalUsernames }, type: "user" }).select("_id");
        const msgIds = msgs.map(m => m._id.toString());
        if (msgIds.length) await Message.deleteMany({ _id: { $in: msgIds } });

        // delete users
        await User.deleteMany({ role: "user" });

        // kick removed users
        for (const uname of normalUsernames) {
          const socketsSet = activeUsers.get(uname);
          if (socketsSet && socketsSet.size) {
            for (const sid of socketsSet) {
              io.to(sid).emit("banned", { text: "Du wurdest entfernt (deleteAllUsers)." });
              const s = io.sockets.sockets.get(sid);
              if (s) { try { s.disconnect(true); } catch (e) {} }
              authenticatedSockets.delete(sid);
            }
            activeUsers.delete(uname);
            userRoles.delete(uname);
            userFilters.delete(uname);
          }
        }

        // inform remaining authenticated clients
        for (const sid of authenticatedSockets) {
          io.to(sid).emit("deletedMessages", msgIds);
          io.to(sid).emit("systemMessage", { text: "✅ Alle normalen Nutzer wurden gelöscht.", type: "ok", duration: 5000 });
          io.to(sid).emit("updateUsersAndMessages");
        }

        emitToAdmins("adminNotice", { text: `${username} hat alle normalen Nutzer gelöscht.` });
      } catch (err) {
        console.error("deleteAllUsers Fehler:", err);
        socket.emit("systemMessage", { text: "Fehler beim Löschen der Nutzer.", type: "error", duration: 4000 });
      }
      return;
    }

    // --- /reset ---
    if (finalContent.startsWith("/reset")) {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error", duration: 4000 });
      const provided = finalContent.split(" ")[1]?.trim();
      if (provided !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error", duration: 4000 });

      await User.deleteMany({});
      userRoles.clear();
      activeUsers.clear();
      userFilters.clear();
      await Message.deleteMany({});

      io.emit("systemMessage", { text: "⚠️ Server wurde zurückgesetzt! Alles gelöscht.", type: "error", duration: 5000 });
      io.emit("forceReload", true);
      return;
    }

    // --- /ban "username" ADMIN_PASS ---
    const banMatch = finalContent.match(/^\/ban\s+(?:"([^"]+)"|(\S+))\s+(\S+)/i);
    if (banMatch) {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error", duration: 4000 });

      const target = (banMatch[1] || banMatch[2] || "").trim();
      const providedPass = banMatch[3];

      if (!target) return socket.emit("systemMessage", { text: "Benutzername fehlt.", type: "error", duration: 4000 });
      if (providedPass !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Ungültiges Admin-Passwort für /ban.", type: "error", duration: 4000 });
      if (target === username) return socket.emit("systemMessage", { text: "Du kannst dich nicht selbst bannen.", type: "error", duration: 4000 });

      try {
        // delete user
        await User.findOneAndDelete({ username: target });

        // delete user's messages (user-type)
        const msgs = await Message.find({ sender: target, type: "user" }).select("_id");
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

        // inform remaining authenticated clients
        for (const sid of authenticatedSockets) {
          io.to(sid).emit("deletedMessages", msgIds);
          io.to(sid).emit("systemMessage", { text: `⚠️ Nutzer "${target}" wurde gebannt und entfernt.`, type: "error", duration: 5000 });
          io.to(sid).emit("updateUsersAndMessages");
        }

        emitToAdmins("adminNotice", { text: `${username} hat ${target} gebannt.` });
      } catch (err) {
        console.error("Ban-Fehler:", err);
        socket.emit("systemMessage", { text: "Fehler beim Bannen des Nutzers.", type: "error", duration: 4000 });
      }
      return;
    }

    // --- Normale Nachricht ---
    if (finalContent.length > 150) finalContent = finalContent.slice(0, 150);
    if (userFilters.get(username)) finalContent = filterMessage(finalContent);

    const msg = new Message({ sender: username, content: finalContent, senderRole: role, type: "user" });
    await msg.save();

    const deletedIds = await trimOldMessages(100);
    if (deletedIds.length) {
      for (const sid of authenticatedSockets) {
        io.to(sid).emit("deletedMessages", deletedIds);
      }
    }

    // send new message to authenticated clients only
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
    if (!socket.username) return;
    userFilters.set(socket.username, !!active);
  });
};
