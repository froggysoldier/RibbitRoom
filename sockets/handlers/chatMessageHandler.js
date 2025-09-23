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
    
    if (finalContent.startsWith("/")) {
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
          if (dbUser) { 
            dbUser.role = "admin"; 
            await dbUser.save(); 
          }
          role = "admin";
          userRoles.set(username, role);
  
          // Neues Token an den eigenen Client
          const newToken = jwt.sign({ username, role }, JWT_SECRET, { expiresIn: "7d" });
          socket.emit("newToken", { token: newToken });
  
          // Systemnachricht für den eigenen Client
          socket.emit("systemMessage", { text: "✔️ Du bist jetzt Admin.", type: "ok" });
  
          // Rolle sofort für alle authentifizierten Clients aktualisieren
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
      if (finalContent === "/clear") {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
        // nur Chat löschen
        await Message.deleteMany({});
        // optional: sende ids of deleted messages (clients löschen)
        io.emit("deletedMessages", []); // clients emptyen chat
        // notify all authenticated clients to reload messages (but not logout)
        for (const sid of authenticatedSockets) {
          io.to(sid).emit("systemMessage", { text: "⚠️ Alle Nachrichten gelöscht.", type: "error" });
          io.to(sid).emit("updateUsersAndMessages");
        }
        return;
      }
  
      // --- /deleteAllUsers [passwort] ---
      if (finalContent.startsWith("/deleteAllUsers")) {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
        const provided = finalContent.split(" ")[1]?.trim();
        if (provided !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
  
        try {
          // finde alle normalen user (vor dem löschen)
          const normalUsers = await User.find({ role: "user" }).select("username");
          const normalUsernames = normalUsers.map(u => u.username);
  
          // lösche deren Nachrichten (zuerst ids sammeln)
          const msgs = await Message.find({ sender: { $in: normalUsernames } }).select("_id");
          const msgIds = msgs.map(m => m._id.toString());
          if (msgIds.length) await Message.deleteMany({ _id: { $in: msgIds } });
  
          // lösche user aus DB
          await User.deleteMany({ role: "user" });
  
          // kick/notify die gelöschten user (falls online)
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
  
          // inform remaining authenticated clients: remove messages + refresh active users
          for (const sid of authenticatedSockets) {
            // notify to reload lists and messages
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
        // notify all sockets - reset = logout all
        io.emit("systemMessage", { text: "⚠️ Server wurde zurückgesetzt! Alles gelöscht.", type: "error" });
        io.emit("forceReload", true);
        return;
      }
  
  // --- /ban "username" ADMIN_PASS ---
  const banMatch = finalContent.match(/^\/ban\s*(?:"([^"]+)"|(\S+))?\s*(\S+)?/i);
  if (banMatch) {
    if (role !== "admin") {
      socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
      return; // ❗ stoppt normale Nachricht
    }
  
    const target = (banMatch[1] || banMatch[2] || "").trim();
    const providedPass = banMatch[3];
  
    if (!target) {
      socket.emit("systemMessage", { text: "Benutzername fehlt.", type: "error" });
      return;
    }
    if (!providedPass) {
      socket.emit("systemMessage", { text: "Admin-Passwort fehlt.", type: "error" });
      return;
    }
    if (providedPass !== ADMIN_PASS) {
      socket.emit("systemMessage", { text: "Ungültiges Admin-Passwort für /ban.", type: "error" });
      return;
    }
    if (target === username) {
      socket.emit("systemMessage", { text: "Du kannst dich nicht selbst bannen.", type: "error" });
      return;
    }
  
    try {
      // 1) User löschen
      await User.findOneAndDelete({ username: target });
  
      // 2) Nachrichten löschen
      const msgs = await Message.find({ sender: target }).select("_id");
      const msgIds = msgs.map((m) => m._id.toString());
      if (msgIds.length) await Message.deleteMany({ _id: { $in: msgIds } });
  
      // 3) Sessions kicken
      const socketsSet = activeUsers.get(target);
      if (socketsSet && socketsSet.size) {
        for (const sid of socketsSet) {
          io.to(sid).emit("banned", { text: "Du wurdest vom Admin gebannt und entfernt." });
          const s = io.sockets.sockets.get(sid);
          if (s) {
            try {
              s.disconnect(true);
            } catch (e) {}
          }
          authenticatedSockets.delete(sid);
        }
        activeUsers.delete(target);
        userRoles.delete(target);
        userFilters.delete(target);
      }
  
      // 4) Broadcast an andere
      for (const sid of authenticatedSockets) {
        io.to(sid).emit("deletedMessages", msgIds);
        io.to(sid).emit("systemMessage", {
          text: `⚠️ Nutzer "${target}" wurde gebannt und entfernt.`,
          type: "error",
        });
        setTimeout(() => io.to(sid).emit("updateUsersAndMessages"), 500);
      }
  
      emitToAdmins("adminNotice", { text: `${username} hat ${target} gebannt.` });
    } catch (err) {
      console.error("Ban-Fehler:", err);
      socket.emit("systemMessage", { text: "Fehler beim Bannen des Nutzers.", type: "error" });
    }
    return; // ❗ verhindert, dass /ban als normale Nachricht rausgeht
  }
  
  
        
    return; // <--- Nachricht wird nicht im Chat angezeigt
  }
      
  // --- Normale Nachricht ---
  if (finalContent.length > 150) finalContent = finalContent.slice(0, 150);
  if (userFilters.get(username)) finalContent = filterMessage(finalContent);

  const msg = new Message({ sender: username, content: finalContent, senderRole: role });
  await msg.save();

  const deletedIds = await trimOldMessages(100);
  if (deletedIds.length) {
    // only authenticated clients should receive deletedMessages
    for (const sid of authenticatedSockets) {
      io.to(sid).emit("deletedMessages", deletedIds);
    }
  }

  // only send new message to authenticated clients
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
