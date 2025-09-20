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
    broadcastActiveUsers,
    JWT_SECRET,
    ADMIN_PASS,
    io
  } = ctx;

  socket.on("chatMessage", async (content) => {
    if (!username) return;

    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    // --- Anti-Spam: nur alle 0,62 Sekunden ---
    const now = Date.now();
    const lastTime = lastMessageTime.get(username) || 0;
    if (now - lastTime < 620) {
      return socket.emit("systemMessage", { text: "⚠️ Bitte nicht Nachrichten spammen.", type: "error" });
    }
    lastMessageTime.set(username, now);

    let finalContent = (content || "").trim();

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

        // Neues Token an den eigenen Client
        const newToken = jwt.sign({ username, role }, JWT_SECRET, { expiresIn: "7d" });
        socket.emit("newToken", { token: newToken });

        // eigene Systemnachricht
        socket.emit("systemMessage", { text: "✔️ Du bist jetzt Admin.", type: "ok" });

        // Broadcast userlist update & role update für UI (Name im Chat)
        broadcastActiveUsers();
        io.emit("roleUpdated", { username, role });

        // Admin-Notice an bestehende Admins
        emitToAdmins("adminNotice", { text: `${username} ist jetzt Admin.` });
      } else {
        socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
      }
      return;
    }

    // --- /clear ---
    if (finalContent === "/clear") {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
      await Message.deleteMany({});
      io.emit("deletedMessages", []);
      io.emit("systemMessage", { text: "⚠️ Alle Nachrichten gelöscht.", type: "error" });
      io.emit("forceReload", false);
      return;
    }

    // --- /deleteAllUsers [passwort] ---
    if (finalContent.startsWith("/deleteAllUsers")) {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
      const provided = finalContent.split(" ")[1]?.trim();
      if (provided !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });

      try {
        // 1) Namen aller normalen Nutzer (DB)
        const normalUsersDocs = await User.find({ role: "user" }).select("username");
        const normalUsernames = normalUsersDocs.map(d => d.username);

        // 2) Nachrichten-IDs sammeln & löschen
        const messagesToDelete = await Message.find({ sender: { $in: normalUsernames } }).select("_id");
        const deletedIds = messagesToDelete.map(m => m._id.toString());
        if (normalUsernames.length) {
          await Message.deleteMany({ sender: { $in: normalUsernames } });
        }

        // 3) Accounts löschen
        await User.deleteMany({ role: "user" });

        // 4) Kick + banned event für aktive normale Nutzer
        for (const uname of normalUsernames) {
          const socketsSet = activeUsers.get(uname);
          if (socketsSet && socketsSet.size) {
            for (const sid of socketsSet) {
              io.to(sid).emit("banned", { text: "Du wurdest vom Admin entfernt (deleteAllUsers)." });
              const s = io.sockets.sockets.get(sid);
              if (s) {
                try { s.disconnect(true); } catch (e) {}
              }
            }
            activeUsers.delete(uname);
            userRoles.delete(uname);
            userFilters.delete(uname);
          }
        }

        // 5) Broadcast Änderungen: gelöschte messages & userlist refresh
        if (deletedIds.length) io.emit("deletedMessages", deletedIds);
        // signal an clients, dass sie userliste & messages neu laden sollen
        io.emit("updateUsersAndMessages");

        socket.emit("systemMessage", { text: "✅ Alle normalen Nutzer gelöscht.", type: "ok" });
        emitToAdmins("adminNotice", { text: `${username} hat alle normalen Nutzer gelöscht.` });
      } catch (err) {
        console.error("deleteAllUsers Fehler:", err);
        socket.emit("systemMessage", { text: "Fehler beim Löschen aller Nutzer.", type: "error" });
      }

      return;
    }

    // --- /reset [passwort] ---
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

    // --- /ban "username" ADMIN_PASS ---
    const banMatch = finalContent.match(/^\/ban\s+(?:"([^"]+)"|(\S+))\s+(\S+)/i);
    if (banMatch) {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });

      const target = (banMatch[1] || banMatch[2] || "").trim();
      const providedPass = banMatch[3];

      if (!target) return socket.emit("systemMessage", { text: "Benutzername fehlt.", type: "error" });
      if (providedPass !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Ungültiges Admin-Passwort für /ban.", type: "error" });

      try {
        // 1) User löschen
        await User.findOneAndDelete({ username: target });
        // 2) Nachrichten löschen
        const messagesToDelete = await Message.find({ sender: target }).select("_id");
        const deletedIds = messagesToDelete.map(m => m._id.toString());
        if (deletedIds.length) await Message.deleteMany({ sender: target });

        // 3) Aktive Sessions kicken
        const socketsSet = activeUsers.get(target);
        if (socketsSet && socketsSet.size) {
          for (const sid of socketsSet) {
            io.to(sid).emit("banned", { text: "Du wurdest vom Admin gebannt und entfernt." });
            const s = io.sockets.sockets.get(sid);
            if (s) try { s.disconnect(true); } catch {}
          }
          activeUsers.delete(target);
          userRoles.delete(target);
          userFilters.delete(target);
        }

        // 4) Broadcast Löschungen + userlist refresh
        if (deletedIds.length) io.emit("deletedMessages", deletedIds);
        io.emit("updateUsersAndMessages");

        io.emit("systemMessage", { text: `⚠️ Nutzer "${target}" wurde gebannt und entfernt.`, type: "error" });
        emitToAdmins("adminNotice", { text: `${username} hat ${target} gebannt.` });
      } catch (err) {
        console.error("Ban-Fehler:", err);
        socket.emit("systemMessage", { text: "Fehler beim Bannen des Nutzers.", type: "error" });
      }
      return;
    }

    // --- Normale Nachricht ---
    if (finalContent.length > 150) finalContent = finalContent.slice(0, 150);
    if (userFilters.get(username)) finalContent = filterMessage(finalContent);

    const msg = new Message({ sender: username, content: finalContent, senderRole: role });
    await msg.save();

    const deletedIds = await trimOldMessages(100);
    if (deletedIds.length) io.emit("deletedMessages", deletedIds);

    io.emit("newMessage", {
      _id: msg._id.toString(),
      sender: msg.sender,
      content: msg.content,
      createdAt: msg.createdAt,
      senderRole: role,
      type: "user"
    });
  });

  socket.on("toggleFilter", (active) => {
    if (!username) return;
    userFilters.set(username, !!active);
  });
};
