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
    lastMessageTime,
    trimOldMessages,
    emitToAdmins,
    authenticatedSockets,
    JWT_SECRET,
    ADMIN_PASS,
  } = ctx;

  const normalize = (u) => String(u || "").trim().toLowerCase();
  ctx.userTimeouts = ctx.userTimeouts || new Map();
  ctx.messageHistory = ctx.messageHistory || new Map();
  ctx.timeoutIntervals = ctx.timeoutIntervals || new Map();
  const userTimeouts = ctx.userTimeouts;
  const messageHistory = ctx.messageHistory;
  const timeoutIntervals = ctx.timeoutIntervals;

  // ✅ Token prüfen und Usernamen extrahieren
  let username = null;
  try {
    const token = socket.handshake.auth?.token;
    if (!token) throw new Error("Kein Token");
    const decoded = jwt.verify(token, JWT_SECRET);
    username = decoded.username;
  } catch (err) {
    console.warn("[userHandler] Ungültiger oder fehlender Token:", err.message);
    socket.emit("systemMessage", { text: "❌ Nicht authentifiziert.", type: "error" });
    socket.disconnect();
    return;
  }

  if (!username) return;

  const dbUser = await User.findOne({ username });
  let role = dbUser?.role || "user";
  userRoles.set(username, role);
  if (!userFilters.has(username)) userFilters.set(username, false);

  console.log(`💬 ChatHandler aktiv für ${username} (${role})`);

  // Zeitformatierung
  const formatDuration = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${h}h ${min}m`;
  };

  // Hilfsfunktion: Sockets eines Users finden
  const findActiveSocketsFor = (targetNorm) => {
    for (const [uname, socketsSet] of activeUsers.entries()) {
      if (normalize(uname) === targetNorm) return socketsSet;
    }
    return null;
  };

  // ============================
  //      CHAT MESSAGE HANDLER
  // ============================
  socket.on("chatMessage", async (content) => {
    if (!username) return;
    const now = Date.now();
    const myNorm = normalize(username);

    // Timeout prüfen
    const timeoutUntil = userTimeouts.get(myNorm);
    if (timeoutUntil && now < timeoutUntil) {
      const remaining = Math.ceil((timeoutUntil - now) / 1000);
      socket.emit("systemMessage", {
        text: `⚠️ Du bist noch für ${formatDuration(remaining)} gemutet.`,
        type: "error",
      });
      return;
    }

    // Anti-Spam
    const lastTime = lastMessageTime.get(username) || 0;
    const MIN_INTERVAL = 500;
    if (now - lastTime < MIN_INTERVAL) {
      socket.emit("systemMessage", { text: "⚠️ Bitte nicht spammen.", type: "error" });
      return;
    }
    lastMessageTime.set(username, now);

    // Flood Detection
    const hist = messageHistory.get(myNorm) || [];
    const recent = hist.filter((t) => now - t < 10000);
    recent.push(now);
    messageHistory.set(myNorm, recent);
    if (recent.length > 7) {
      socket.emit("systemMessage", { text: "⚠️ Zu viele Nachrichten auf einmal.", type: "error" });
      return;
    }

    let msgText = (content || "").trim();
    if (!msgText) return;

    // Textlimit
    if (msgText.length > 150) msgText = msgText.slice(0, 150);

    // Filter
    if (userFilters.get(username)) msgText = filterMessage(msgText);

    // ============================
    //       BEFEHLE
    // ============================
    if (msgText.startsWith("/")) {
      const parts = msgText.split(" ");
      const cmd = parts[0].toLowerCase();

      // /help
      if (cmd === "/help") {
        socket.emit("systemMessage", {
          text: `
ℹ️ Befehle:
• /role                                  → Zeigt deine Rolle
• /admin [passwort]                      → Admin werden
• /ban "username" [passwort]             → User bannen
• /timeout "username" sekunden           → User temporär muten
• /clear                                 → Chat leeren (Admins)
• /listUsers                             → Liste der Online-User (Admins)
• /deleteAllUsers [passwort]             → Alle normalen User löschen
• /reset [passwort]                      → Server zurücksetzen
• /help                                  → Zeigt diese Hilfe
          `.trim(),
          type: "info",
          duration: 15000,
        });
        return;
      }

      // /role
      if (cmd === "/role") {
        socket.emit("systemMessage", { text: `🧩 Deine Rolle: ${role}`, type: "info" });
        return;
      }

      // /admin
      if (cmd === "/admin") {
        const provided = parts[1];
        if (provided === ADMIN_PASS) {
          dbUser.role = "admin";
          await dbUser.save();
          role = "admin";
          userRoles.set(username, role);
          const newToken = jwt.sign({ username, role }, JWT_SECRET, { expiresIn: "7d" });
          socket.emit("newToken", { token: newToken });
          socket.emit("systemMessage", { text: "✅ Du bist jetzt Admin.", type: "ok" });
        } else {
          socket.emit("systemMessage", { text: "❌ Falsches Admin-Passwort.", type: "error" });
        }
        return;
      }

      // /clear
      if (cmd === "/clear") {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins dürfen das.", type: "error" });
        await Message.deleteMany({});
        io.emit("deletedMessages", []);
        io.emit("systemMessage", { text: "🧹 Chat geleert.", type: "info" });
        return;
      }

      // /listUsers
      if (cmd === "/listusers") {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins dürfen das.", type: "error" });
        const users = Array.from(activeUsers.keys()).map((u) => {
          const isMuted = userTimeouts.get(normalize(u)) > Date.now();
          const r = userRoles.get(u) || "user";
          return `${u} (${r})${isMuted ? " 🔇" : ""}`;
        });
        socket.emit("systemMessage", {
          text: `👥 Online:\n${users.join("\n")}`,
          type: "info",
        });
        return;
      }

      // /ban "username" passwort
      if (cmd === "/ban") {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins dürfen das.", type: "error" });
        const match = msgText.match(/^\/ban\s+(?:"([^"]+)"|(\S+))\s+(\S+)/i);
        if (!match) return socket.emit("systemMessage", { text: "Syntax: /ban \"username\" passwort", type: "info" });
        const target = match[1] || match[2];
        const pw = match[3];
        if (pw !== ADMIN_PASS) return socket.emit("systemMessage", { text: "❌ Falsches Passwort.", type: "error" });

        await User.findOneAndDelete({ username: target });
        await Message.deleteMany({ sender: target });

        const socketsSet = findActiveSocketsFor(normalize(target));
        if (socketsSet) {
          for (const sid of socketsSet) {
            io.to(sid).emit("banned", { text: "🚫 Du wurdest gebannt." });
            const s = io.sockets.sockets.get(sid);
            if (s) s.disconnect(true);
            authenticatedSockets.delete(sid);
          }
        }

        activeUsers.delete(target);
        userRoles.delete(target);
        userFilters.delete(target);

        io.emit("systemMessage", { text: `⚠️ ${target} wurde gebannt.`, type: "error" });
        return;
      }

      // /timeout "username" sekunden
      if (cmd === "/timeout") {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins dürfen das.", type: "error" });
        const match = msgText.match(/^\/timeout\s+(?:"([^"]+)"|(\S+))\s+(\d+)/i);
        if (!match) return socket.emit("systemMessage", { text: "Syntax: /timeout \"username\" sekunden", type: "info" });

        const target = match[1] || match[2];
        let duration = parseInt(match[3]);
        if (isNaN(duration) || duration <= 0) return;
        const until = Date.now() + duration * 1000;
        userTimeouts.set(normalize(target), until);

        const socketsSet = findActiveSocketsFor(normalize(target));
        if (socketsSet)
          for (const sid of socketsSet)
            io.to(sid).emit("systemMessage", { text: `🔇 Du bist für ${formatDuration(duration)} gemutet.`, type: "error" });

        emitToAdmins("adminNotice", { text: `${target} wurde für ${duration}s gemutet.` });
        return;
      }

      // /deleteAllUsers passwort
      if (cmd === "/deleteallusers") {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins dürfen das.", type: "error" });
        const pw = parts[1];
        if (pw !== ADMIN_PASS) return socket.emit("systemMessage", { text: "❌ Falsches Passwort.", type: "error" });
        await User.deleteMany({ role: "user" });
        await Message.deleteMany({});
        io.emit("systemMessage", { text: "🧨 Alle normalen Nutzer gelöscht.", type: "error" });
        io.emit("forceReload", true);
        return;
      }

      // /reset passwort
      if (cmd === "/reset") {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins dürfen das.", type: "error" });
        const pw = parts[1];
        if (pw !== ADMIN_PASS) return socket.emit("systemMessage", { text: "❌ Falsches Passwort.", type: "error" });
        await User.deleteMany({});
        await Message.deleteMany({});
        activeUsers.clear();
        userRoles.clear();
        io.emit("systemMessage", { text: "⚠️ Server wurde zurückgesetzt!", type: "error" });
        io.emit("forceReload", true);
        return;
      }

      socket.emit("systemMessage", { text: `❓ Unbekanntes Kommando: ${cmd}`, type: "info" });
      return;
    }

    // ============================
    //     NORMALE NACHRICHT
    // ============================
    try {
      const msg = new Message({ sender: username, content: msgText, senderRole: role });
      await msg.save();

      const deleted = await trimOldMessages(100);
      if (deleted.length)
        for (const sid of authenticatedSockets) io.to(sid).emit("deletedMessages", deleted);

      for (const sid of authenticatedSockets) {
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
      socket.emit("systemMessage", { text: "❌ Nachricht konnte nicht gesendet werden.", type: "error" });
    }
  });

  socket.on("toggleFilter", (active) => {
    if (!username) return;
    userFilters.set(username, !!active);
  });
}
