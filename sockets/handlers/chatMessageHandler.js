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

  // Spamschutz: Systemwarnungen pro User tracken
  const spamWarningShown = new Map();

  socket.on("chatMessage", async (content) => {
    if (!username) return;

    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    content = (content || "").trim();

    // --- Spam-Schutz ---
    const now = Date.now();
    const lastTime = lastMessageTime.get(username) || 0;
    const cooldown = 700;
    const diff = now - lastTime;

    if (diff < cooldown) {
      const remaining = cooldown - diff;

      if (!spamWarningShown.get(username)) {
        const msgId = "spam-warn-" + username;
        socket.emit("systemMessage", { 
          text: `⚠️ Bitte nicht Nachrichten spammen. Warte ${Math.ceil(remaining/1000)}s`, 
          type: "error", 
          id: msgId 
        });
        spamWarningShown.set(username, msgId);
      }

      lastMessageTime.set(username, now);
      return;
    }

    // Cooldown vorbei → Systemwarnung entfernen
    const msgId = spamWarningShown.get(username);
    if (msgId) {
      socket.emit("removeSystemMessage", msgId);
      spamWarningShown.delete(username);
    }
    lastMessageTime.set(username, now);

    // --- Chat Commands ---
    if (content === "/role") {
      socket.emit("systemMessage", { text: `ℹ️ Deine Rolle ist: ${role}`, type: "info"});
      return;
    }

    if (content === "/help") {
      socket.emit("systemMessage", { 
        text: `/admin [passwort] - Admin werden
              /clear - Chat leeren (Admins)
              /deleteAllUsers [passwort] - Alle normalen User löschen
              /reset [passwort] - Server zurücksetzen
              /ban "username" ADMIN_PASS - User bannen
              /role - Zeigt deine aktuelle Rolle
              /help - Zeigt diese Nachricht`,
        type: "info",
        duration: 10000
      });
      return;
    }

    // --- Admin Commands ---
    const adminMatch = content.match(/^\/admin\s*(?:[:]\s*)?(.*)$/i);
    if (adminMatch) {
      const provided = (adminMatch[1] || "").trim();
      if (provided && provided === ADMIN_PASS) {
        if (dbUser) { dbUser.role = "admin"; await dbUser.save(); }
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

    // --- /clear ---
    if (content === "/clear") {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
      await Message.deleteMany({});
      for (const sid of authenticatedSockets) {
        io.to(sid).emit("deletedMessages", []);
        io.to(sid).emit("systemMessage", { text: "⚠️ Alle Nachrichten gelöscht.", type: "error" });
        io.to(sid).emit("updateUsersAndMessages");
      }
      return;
    }

    // --- /deleteAllUsers ---
    if (content.startsWith("/deleteAllUsers")) {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
      const provided = content.split(" ")[1]?.trim();
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
      return;
    }

    // --- /reset ---
    if (content.startsWith("/reset")) {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
      const provided = content.split(" ")[1]?.trim();
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

    // --- /ban ---
    const banMatch = content.match(/^\/ban\s+(?:"([^"]+)"|(\S+))\s+(\S+)/i);
    if (banMatch) {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });

      const target = (banMatch[1] || banMatch[2] || "").trim();
      const providedPass = banMatch[3];
      if (!target) return socket.emit("systemMessage", { text: "Benutzername fehlt.", type: "error" });
      if (providedPass !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Ungültiges Admin-Passwort für /ban.", type: "error" });
      if (target === username) return socket.emit("systemMessage", { text: "Du kannst dich nicht selbst bannen.", type: "error" });

      try {
        await User.findOneAndDelete({ username: target });
        const msgs = await Message.find({ sender: target }).select("_id");
        const msgIds = msgs.map(m => m._id.toString());
        if (msgIds.length) await Message.deleteMany({ _id: { $in: msgIds } });

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
      return;
    }

    // --- Normale Nachricht ---
    if (content.length > 150) content = content.slice(0, 150);
    if (userFilters.get(username)) content = filterMessage(content);

    const msg = new Message({ sender: username, content, senderRole: role });
    await msg.save();

    const deletedIds = await trimOldMessages(100);

    // Neue Nachricht an alle authentifizierten Clients
    for (const sid of authenticatedSockets) {
      io.to(sid).emit("newMessage", {
        _id: msg._id.toString(),
        sender: msg.sender,
        content: msg.content,
        createdAt: msg.createdAt,
        senderRole: role,
        type: "user"
      });
      if (deletedIds.length) io.to(sid).emit("deletedMessages", deletedIds);
    }
  });

  socket.on("toggleFilter", (active) => {
    if (!username) return;
    userFilters.set(username, !!active);
  });
};
