// sockets/handlers/chatMessageHandler.js
const jwt = require("jsonwebtoken");
const Message = require("../../models/Message");
const User = require("../../models/User");
const filterMessage = require("../../utils/filter");

module.exports = function(socket, ctx) {
  let {
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

  let username = null;
  let role = "user";

  // --- IDENTIFY EVENT: Client meldet Token ---
  socket.on("identify", async ({ token }) => {
    if (!token) return;

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      username = decoded.username;
      role = decoded.role || "user";

      // socket als authentifiziert markieren
      socket.user = { username, authenticated: true };
      userRoles.set(username, role);

      // aktiven User speichern
      if (!activeUsers.has(username)) activeUsers.set(username, new Set());
      activeUsers.get(username).add(socket.id);

      // Filterstatus
      userFilters.set(username, false);

      socket.emit("identified", { username, role, filterActive: false });
      io.sockets.sockets.forEach(s => {
        if (s.user?.authenticated) {
          s.emit("activeUsers", Array.from(userRoles.keys()).map(u => ({
            username: u,
            role: userRoles.get(u) || "user"
          })));
        }
      });
    } catch (err) {
      console.warn("[IDENTIFY] Token ungültig:", err.message);
      socket.user = { authenticated: false };
    }
  });

  // --- CHAT MESSAGE ---
  socket.on("chatMessage", async (content) => {
    if (!socket.user?.authenticated) return;
    if (!username) return;

    const dbUser = await User.findOne({ username });
    role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    // --- Anti-Spam ---
    const now = Date.now();
    const lastTime = lastMessageTime.get(username) || 0;
    if (now - lastTime < 620) return socket.emit("systemMessage", { text: "⚠️ Bitte nicht Nachrichten spammen.", type: "error" });
    lastMessageTime.set(username, now);

    let finalContent = content.trim();

    // --- /admin ---
    const adminMatch = finalContent.match(/^\/admin\s*(?:[:]\s*)?(.*)$/i);
    if (adminMatch) {
      const provided = (adminMatch[1] || "").trim();
      if (provided && provided === ADMIN_PASS) {
        if (dbUser) { dbUser.role = "admin"; await dbUser.save(); }
        role = "admin";
        userRoles.set(username, role);

        const newToken = jwt.sign({ username, role }, JWT_SECRET, { expiresIn: "7d" });
        socket.emit("newToken", { token: newToken });
        socket.emit("systemMessage", { text: "✔️ Du bist jetzt Admin.", type: "ok" });

        // Rolle für alle Clients aktualisieren
        io.sockets.sockets.forEach(s => {
          if (s.user?.authenticated) s.emit("roleUpdated", { username, role });
        });

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
      io.sockets.sockets.forEach(s => {
        if (s.user?.authenticated) s.emit("deletedMessages", []);
        if (s.user?.authenticated) s.emit("systemMessage", { text: "⚠️ Alle Nachrichten gelöscht.", type: "error" });
        if (s.user?.authenticated) s.emit("forceReload", false);
      });
      return;
    }

    // --- /deleteAllUsers [passwort] ---
    if (finalContent.startsWith("/deleteAllUsers")) {
      if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
      const provided = finalContent.split(" ")[1]?.trim();
      if (provided !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });

      // alle normalen Nutzer löschen
      await User.deleteMany({ role: "user" });

      // Nachrichten aller gelöschten Nutzer löschen
      const usersToDelete = Array.from(userRoles.entries())
        .filter(([uname, urole]) => urole !== "admin")
        .map(([uname]) => uname);

      await Message.deleteMany({ sender: { $in: usersToDelete } });

      // Rollen & aktive User aktualisieren
      usersToDelete.forEach(u => {
        activeUsers.delete(u);
        userRoles.delete(u);
        userFilters.delete(u);
      });

      // Reload nur für authentifizierte Clients
      io.sockets.sockets.forEach(s => {
        if (s.user?.authenticated) s.emit("forceReload", false);
      });

      socket.emit("systemMessage", { text: "✅ Alle normalen Nutzer gelöscht.", type: "ok" });
      emitToAdmins("adminNotice", { text: `${username} hat alle normalen Nutzer gelöscht.` });
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

      io.sockets.sockets.forEach(s => {
        if (s.user?.authenticated) s.emit("forceReload", true);
      });

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
        await User.findOneAndDelete({ username: target });
        await Message.deleteMany({ sender: target });

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

        io.sockets.sockets.forEach(s => {
          if (s.user?.authenticated) s.emit("systemMessage", { text: `⚠️ Nutzer "${target}" wurde gebannt und entfernt.`, type: "error" });
        });
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

    io.sockets.sockets.forEach(s => {
      if (s.user?.authenticated) {
        if (deletedIds.length) s.emit("deletedMessages", deletedIds);
        s.emit("newMessage", {
          _id: msg._id.toString(),
          sender: msg.sender,
          content: msg.content,
          createdAt: msg.createdAt,
          senderRole: role,
          type: "user"
        });
      }
    });
  });

  socket.on("toggleFilter", (active) => {
    if (!socket.user?.authenticated) return;
    userFilters.set(username, !!active);
  });

  // --- Cleanup bei Disconnect ---
  socket.on("disconnect", () => {
    if (!username) return;
    const set = activeUsers.get(username);
    if (set) set.delete(socket.id);
    if (!set || set.size === 0) {
      activeUsers.delete(username);
      userRoles.delete(username);
      userFilters.delete(username);
      io.sockets.sockets.forEach(s => {
        if (s.user?.authenticated) s.emit("activeUsers", Array.from(userRoles.keys()).map(u => ({
          username: u,
          role: userRoles.get(u) || "user"
        })));
      });
    }
  });
};
