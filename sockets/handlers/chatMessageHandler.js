// sockets/handlers/chatMessageHandler.js
import jwt from "jsonwebtoken";
import Message from "../../models/Message.js";
import User from "../../models/User.js";
import filterMessage from "../../utils/filter.js";

export default function chatMessageHandler(socket, ctx) {
  const {
    io,
    activeUsers,
    userRoles,
    userFilters,
    authenticatedSockets,
    emitToAdmins,
    trimOldMessages,
    lastMessageTime,
    JWT_SECRET,
    ADMIN_PASS,
  } = ctx;

  const normalize = (u) => String(u || "").trim().toLowerCase();
  ctx.userTimeouts = ctx.userTimeouts || new Map();
  ctx.messageHistory = ctx.messageHistory || new Map();
  ctx.timeoutIntervals = ctx.timeoutIntervals || new Map();
  const userTimeouts = ctx.userTimeouts;
  const messageHistory = ctx.messageHistory;

  // username wird durch userHandler in socket.data gesetzt
  socket.on("chatMessage", async (content) => {
    const username = socket.data?.username;
    if (!username) {
      socket.emit("systemMessage", { text: "Nicht eingeloggt.", type: "error" });
      return;
    }

    const now = Date.now();
    const myNorm = normalize(username);

    // --- Mute prüfen ---
    const timeoutUntil = userTimeouts.get(myNorm);
    if (timeoutUntil && now < timeoutUntil) {
      const remainingSec = Math.ceil((timeoutUntil - now) / 1000);
      socket.emit("systemMessage", { text: `⚠️ Du bist noch ${remainingSec}s gemutet.`, type: "error" });
      return;
    }

    // --- Anti-Spam ---
    const MIN_INTERVAL = 350;
    const lastTime = lastMessageTime.get(username) || 0;
    if (now - lastTime < MIN_INTERVAL) {
      lastMessageTime.set(username, now);
      socket.emit("systemMessage", { text: "⚠️ Bitte nicht spammen.", type: "error" });
      return;
    }
    lastMessageTime.set(username, now);

    // --- Flood History ---
    const HISTORY_LIMIT = 7;
    const TIME_WINDOW = 10000;
    const hist = messageHistory.get(myNorm) || [];
    const recent = hist.filter(ts => now - ts <= TIME_WINDOW);
    recent.push(now);
    messageHistory.set(myNorm, recent);
    if (recent.length > HISTORY_LIMIT) {
      socket.emit("systemMessage", { text: "⚠️ Zu viele Nachrichten. Bitte warte.", type: "error" });
      return;
    }

    // Rolle prüfen
    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    let finalContent = (content || "").trim();
    if (!finalContent) return;

    // --- Befehle ---
    if (finalContent.startsWith("/")) {
      // /help
      if (finalContent === "/help") {
        socket.emit("systemMessage", {
          text: `
ℹ️ Befehle:
• /admin [passwort]
• /ban "username" [passwort]
• /timeout "username" sek
• /clear
• /listUsers
• /deleteAllUsers [passwort]
• /reset [passwort]
• /role
• /help
          `.trim(),
          type: "info",
          duration: 15000
        });
        return;
      }

      if (finalContent === "/role") {
        socket.emit("systemMessage", { text: `Deine Rolle: ${role}`, type: "info" });
        return;
      }

      // /admin
      const adminMatch = finalContent.match(/^\/admin\s*(\S+)?$/i);
      if (adminMatch) {
        const provided = adminMatch[1] || "";
        if (provided === ADMIN_PASS) {
          if (dbUser) { dbUser.role = "admin"; await dbUser.save(); }
          role = "admin";
          userRoles.set(username, role);
          const newToken = jwt.sign({ username, role }, JWT_SECRET, { expiresIn: "7d" });
          socket.emit("newToken", { token: newToken });
          socket.emit("systemMessage", { text: "✔️ Du bist Admin.", type: "ok" });
          emitToAdmins?.("adminNotice", { text: `${username} ist jetzt Admin.` });
        } else {
          socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
        }
        return;
      }

      // /clear
      if (finalContent === "/clear") {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins.", type: "error" });
        await Message.deleteMany({});
        io.emit("deletedMessages", []);
        io.emit("systemMessage", { text: "⚠️ Chat geleert", type: "error" });
        return;
      }

      // /listUsers
      if (finalContent === "/listUsers") {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins.", type: "error" });
        const users = Array.from(activeUsers.keys()).map(u => `${u} (${userRoles.get(u)||'user'})`);
        socket.emit("systemMessage", { text: `Online:\n${users.join("\n")}`, type: "info" });
        return;
      }

      // /ban
      const banMatch = finalContent.match(/^\/ban\s+(?:"([^"]+)"|(\S+))\s+(\S+)/i);
      if (banMatch) {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins.", type: "error" });
        const targetRaw = banMatch[1] || banMatch[2];
        const provided = banMatch[3];
        if (provided !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Falsches Passwort.", type: "error" });

        await User.findOneAndDelete({ username: targetRaw });
        const msgs = await Message.find({ sender: targetRaw }).select("_id");
        const msgIds = msgs.map(m => m._id.toString());
        if (msgIds.length) await Message.deleteMany({ _id: { $in: msgIds } });

        // disconnect target sockets
        for (const [uname, socketsSet] of activeUsers.entries()) {
          if (normalize(uname) === normalize(targetRaw)) {
            for (const sid of socketsSet) {
              io.to(sid).emit("banned", { text: "Du wurdest gebannt." });
              const s = io.sockets.sockets.get(sid);
              if (s) try { s.disconnect(true); } catch {}
              authenticatedSockets.delete(sid);
            }
            activeUsers.delete(uname);
            userRoles.delete(uname);
            userFilters.delete(uname);
          }
        }

        for (const sid of Array.from(authenticatedSockets)) {
          io.to(sid).emit("deletedMessages", msgIds);
          io.to(sid).emit("systemMessage", { text: `⚠️ ${targetRaw} wurde gebannt.`, type: "error" });
          setTimeout(() => io.to(sid).emit("updateUsersAndMessages"), 2000);
        }

        emitToAdmins?.("adminNotice", { text: `${username} hat ${targetRaw} gebannt.` });
        return;
      }

      // /timeout
      const timeoutMatch = finalContent.match(/^\/timeout\s+(?:"([^"]+)"|(\S+))\s+(\d+)/i);
      if (timeoutMatch) {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins.", type: "error" });
        const target = timeoutMatch[1] || timeoutMatch[2];
        let seconds = parseInt(timeoutMatch[3], 10);
        if (isNaN(seconds) || seconds <= 0) return socket.emit("systemMessage", { text: "Ungültige Dauer.", type: "error" });
        const until = Date.now() + seconds * 1000;
        userTimeouts.set(normalize(target), until);

        const socketsSet = (() => {
          for (const [u, s] of activeUsers.entries()) if (normalize(u) === normalize(target)) return s;
          return null;
        })();

        if (socketsSet) {
          for (const sid of socketsSet) {
            io.to(sid).emit("systemMessage", { text: `🔇 Du bist für ${seconds}s gemutet.`, type: "error" });
          }
        }

        emitToAdmins?.("adminNotice", { text: `${target} wurde für ${seconds}s gemutet.` });
        return;
      }

      // /deleteAllUsers
      if (finalContent.startsWith("/deleteAllUsers")) {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins.", type: "error" });
        const pw = finalContent.split(" ")[1];
        if (pw !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Falsches Passwort.", type: "error" });

        const normalUsers = await User.find({ role: "user" }).select("username");
        const normalUsernames = normalUsers.map(u => u.username);
        const msgs = await Message.find({ sender: { $in: normalUsernames } }).select("_id");
        const msgIds = msgs.map(m => m._id.toString());
        if (msgIds.length) await Message.deleteMany({ _id: { $in: msgIds } });
        await User.deleteMany({ role: "user" });

        for (const uname of normalUsernames) {
          const socketsSet = activeUsers.get(uname);
          if (socketsSet) {
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

        for (const sid of Array.from(authenticatedSockets)) {
          io.to(sid).emit("deletedMessages", msgIds);
          io.to(sid).emit("systemMessage", { text: "✅ Alle normalen Nutzer wurden gelöscht.", type: "ok" });
          setTimeout(() => io.to(sid).emit("updateUsersAndMessages"), 2000);
        }

        emitToAdmins?.("adminNotice", { text: `${username} hat alle normalen Nutzer gelöscht.` });
        return;
      }

      // /reset
      if (finalContent.startsWith("/reset")) {
        if (role !== "admin") return socket.emit("systemMessage", { text: "Nur Admins.", type: "error" });
        const pw = finalContent.split(" ")[1];
        if (pw !== ADMIN_PASS) return socket.emit("systemMessage", { text: "Falsches Passwort.", type: "error" });
        await User.deleteMany({});
        await Message.deleteMany({});
        activeUsers.clear();
        userRoles.clear();
        userFilters.clear();
        io.emit("systemMessage", { text: "⚠️ Server wurde zurückgesetzt!", type: "error" });
        io.emit("forceReload", true);
        return;
      }

      socket.emit("systemMessage", { text: `Unbekanntes Kommando: ${finalContent}`, type: "info" });
      return;
    }

    // --- normale Nachricht speichern & broadcasten ---
    if (finalContent.length > 150) finalContent = finalContent.slice(0, 150);
    if (userFilters.get(username)) finalContent = filterMessage(finalContent);

    try {
      const msg = new Message({ sender: username, content: finalContent, senderRole: role });
      await msg.save();

      const deletedIds = await trimOldMessages(100);
      if (deletedIds.length) {
        for (const sid of Array.from(authenticatedSockets)) io.to(sid).emit("deletedMessages", deletedIds);
      }

      for (const sid of Array.from(authenticatedSockets)) {
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
      socket.emit("systemMessage", { text: "Fehler beim Senden.", type: "error" });
    }
  });

  // toggle filter
  socket.on("toggleFilter", (active) => {
    const username = socket.data?.username;
    if (!username) return;
    userFilters.set(username, !!active);
  });
}
