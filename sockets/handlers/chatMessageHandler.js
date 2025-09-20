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
    JWT_SECRET,
    ADMIN_PASS,
    io
  } = ctx;

  socket.on("chatMessage", async (content) => {
    if (!username) return;

    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    // --- Anti-Spam ---
    const now = Date.now();
    const lastTime = lastMessageTime.get(username) || 0;
    if (now - lastTime < 620) {
      return socket.emit("systemMessage", { text: "⚠️ Bitte nicht Nachrichten spammen.", type: "error" });
    }
    lastMessageTime.set(username, now);

    let finalContent = content.trim();

    // --- /admin ---
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
        io.emit("roleUpdated", { username, role });
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
    // --- /deleteAllUsers ---
    if (finalContent.startsWith("/deleteAllUsers")) {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
      const provided = finalContent.split(" ")[1]?.trim();
      if (provided !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
    
      // Alle normalen Nutzer löschen
      const normalUsers = await User.find({ role: "user" });
      const normalUsernames = normalUsers.map(u => u.username);
    
      // Nachrichten der normalen Nutzer löschen
      const messagesToDelete = await Message.find({ sender: { $in: normalUsernames } }, "_id");
      const deletedIds = messagesToDelete.map(m => m._id.toString());
      await Message.deleteMany({ sender: { $in: normalUsernames } });
      await User.deleteMany({ role: "user" });
    
      // Alle normalen Nutzer "bannen" (disconnect + Token löschen)
      normalUsernames.forEach(uname => {
        const socketsSet = activeUsers.get(uname);
        if (socketsSet) {
          for (const sid of socketsSet) {
            io.to(sid).emit("banned", { text: "Du wurdest entfernt, da der Admin alle Nutzer gelöscht hat." });
            const s = io.sockets.sockets.get(sid);
            if (s) try { s.disconnect(true); } catch {}
          }
          activeUsers.delete(uname);
          userRoles.delete(uname);
          userFilters.delete(uname);
        }
  });

  io.emit("deletedMessages", deletedIds); // Chat aktualisieren
  io.emit("updateUsersAndMessages");      // Userliste aktualisieren
  socket.emit("systemMessage", { text: "✅ Alle normalen Nutzer gelöscht.", type: "ok" });
  emitToAdmins("adminNotice", { text: `${username} hat alle normalen Nutzer gelöscht.` });
  return;
}

    // --- /reset ---
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

    // --- /ban ---
    const banMatch = finalContent.match(/^\/ban\s+(?:"([^"]+)"|(\S+))\s+(\S+)/i);
    if (banMatch) {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });

      const target = (banMatch[1] || banMatch[2] || "").trim();
      const providedPass = banMatch[3];

      if (!target) return socket.emit("systemMessage", { text: "Benutzername fehlt.", type: "error" });
      if (providedPass !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Ungültiges Admin-Passwort für /ban.", type: "error" });

      try {
        const messagesToDelete = await Message.find({ sender: target }, "_id");
        const deletedIds = messagesToDelete.map(m => m._id.toString());
        await Message.deleteMany({ sender: target });
        await User.findOneAndDelete({ username: target });

        const socketsSet = activeUsers.get(target);
        if (socketsSet) {
          for (const sid of socketsSet) {
            io.to(sid).emit("banned", { text: "Du wurdest vom Admin gebannt und entfernt." });
            const s = io.sockets.sockets.get(sid);
            if (s) try { s.disconnect(true); } catch {}
          }
          activeUsers.delete(target);
          userRoles.delete(target);
          userFilters.delete(target);
          emitToAdmins("adminNotice", { text: `${username} hat ${target} gebannt.` });
        }

        io.emit("deletedMessages", deletedIds); // Chat aktualisieren
        io.emit("updateUsersAndMessages");       // Userliste aktualisieren
        io.emit("systemMessage", { text: `⚠️ Nutzer "${target}" wurde gebannt und entfernt.`, type: "error" });
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
