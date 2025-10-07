import jwt from "jsonwebtoken";
import Message from "../../models/Message.js";
import User from "../../models/User.js";
import filterMessage from "../../utils/filter.js";

export default function chatMessageHandler(socket, ctx) {
  const {
    activeUsers,
    userRoles,
    userFilters,
    authenticatedSockets,
    broadcastActiveUsers,
    emitToAdmins,
    trimOldMessages,
    lastMessageTime,
    JWT_SECRET,
    ADMIN_PASS,
    io,
  } = ctx;

  let username = null;

  socket.on("registerUsername", (data) => {
    username = data.username;
  });

  const normalize = (u) => String(u || "").trim().toLowerCase();

  const formatDuration = (seconds) => {
    seconds = Math.max(0, Math.floor(seconds));
    if (seconds < 60) return `${seconds} Sekunde${seconds === 1 ? "" : "n"}`;
    const days = Math.floor(seconds / 86400);
    seconds %= 86400;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    seconds %= 60;
    const parts = [];
    if (days) parts.push(`${days} Tag${days === 1 ? "" : "e"}`);
    if (hours) parts.push(`${hours} Stunde${hours === 1 ? "" : "n"}`);
    if (minutes) parts.push(`${minutes} Minute${minutes === 1 ? "" : "n"}`);
    if (seconds) parts.push(`${seconds} Sekunde${seconds === 1 ? "" : "n"}`);
    return parts.join(" ");
  };

  socket.on("chatMessage", async (content) => {
    if (!username) return;

    const now = Date.now();
    const myNorm = normalize(username);

    const MIN_INTERVAL = 350;
    const lastTime = lastMessageTime.get(username) || 0;
    if (now - lastTime < MIN_INTERVAL) {
      return socket.emit("systemMessage", {
        text: "⚠️ Bitte nicht spammen.",
        type: "error",
      });
    }
    lastMessageTime.set(username, now);

    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    let finalContent = (content || "").trim();

    // === BEFEHLE ===
    if (finalContent.startsWith("/")) {
      // /help
      if (finalContent === "/help") {
        socket.emit("systemMessage", {
          text: `
ℹ️ Befehle:
• /admin [passwort] → Admin werden
• /ban "username" [passwort] → User bannen
• /clear → Chat leeren (Admins)
• /deleteAllUsers [passwort] → Alle normalen User löschen
• /reset [passwort] → Server zurücksetzen
• /role → Zeigt deine aktuelle Rolle
• /timeout "username" Sekunden → User temporär muten (Admins)
• /listUsers → Liste der Online-User (Admins)
• /help → Zeigt diese Nachricht
          `.trim(),
          type: "info",
          duration: 15000,
        });
        return;
      }

      // /role
      if (finalContent === "/role") {
        socket.emit("systemMessage", {
          text: `ℹ️ Deine Rolle ist: ${role}`,
          type: "info",
        });
        return;
      }

      // /admin
      const adminMatch = finalContent.match(/^\/admin\s*(\S+)?$/i);
      if (adminMatch) {
        const provided = adminMatch[1] || "";
        if (provided === ADMIN_PASS) {
          role = "admin";
          if (dbUser) {
            dbUser.role = "admin";
            await dbUser.save();
          }
          userRoles.set(username, "admin");
          const newToken = jwt.sign({ username, role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
          socket.emit("newToken", { token: newToken });
          socket.emit("systemMessage", { text: "✔️ Du bist jetzt Admin.", type: "ok" });
          emitToAdmins("adminNotice", { text: `${username} ist jetzt Admin.` });
        } else {
          socket.emit("systemMessage", { text: "❌ Falsches Admin-Passwort.", type: "error" });
        }
        return;
      }

      // /clear
      if (finalContent === "/clear") {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins dürfen das.", type: "error" });
        await Message.deleteMany({});
        io.emit("deletedMessages", []);
        io.emit("systemMessage", { text: "⚠️ Chat wurde geleert.", type: "error" });
        return;
      }

      // /listUsers
      if (finalContent === "/listUsers") {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins dürfen das.", type: "error" });
        const list = Array.from(activeUsers.keys()).map(
          (u) => `${u} (${userRoles.get(u) || "user"})`
        );
        socket.emit("systemMessage", { text: `Online:\n${list.join("\n")}`, type: "info" });
        return;
      }

      // /ban
      const banMatch = finalContent.match(/^\/ban\s+(?:"([^"]+)"|(\S+))\s+(\S+)/i);
      if (banMatch) {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins dürfen das.", type: "error" });
        const targetRaw = banMatch[1] || banMatch[2];
        const pass = banMatch[3];
        if (pass !== ADMIN_PASS)
          return socket.emit("systemMessage", { text: "❌ Falsches Passwort.", type: "error" });
        await User.findOneAndDelete({ username: targetRaw });
        await Message.deleteMany({ sender: targetRaw });
        for (const [u, sockets] of activeUsers.entries()) {
          if (normalize(u) === normalize(targetRaw)) {
            sockets.forEach((sid) => {
              io.to(sid).emit("banned", { text: "Du wurdest gebannt." });
              const s = io.sockets.sockets.get(sid);
              if (s) s.disconnect(true);
              authenticatedSockets.delete(sid);
            });
            activeUsers.delete(u);
            userRoles.delete(u);
          }
        }
        emitToAdmins("adminNotice", { text: `${username} hat ${targetRaw} gebannt.` });
        broadcastActiveUsers();
        return;
      }

      // /timeout
      const timeoutMatch = finalContent.match(/^\/timeout\s+(?:"([^"]+)"|(\S+))\s+(\d+)/i);
      if (timeoutMatch) {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins dürfen das.", type: "error" });
        const target = timeoutMatch[1] || timeoutMatch[2];
        const seconds = parseInt(timeoutMatch[3]);
        if (!target || isNaN(seconds))
          return socket.emit("systemMessage", { text: "Ungültiger Syntax.", type: "error" });

        const until = Date.now() + seconds * 1000;
        if (!ctx.userTimeouts) ctx.userTimeouts = new Map();
        ctx.userTimeouts.set(normalize(target), until);

        socket.emit("systemMessage", {
          text: `⏳ ${target} wurde für ${formatDuration(seconds)} gemutet.`,
          type: "info",
        });
        emitToAdmins("adminNotice", { text: `${target} gemutet (${seconds}s).` });
        return;
      }

      // /deleteAllUsers
      if (finalContent.startsWith("/deleteAllUsers")) {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins.", type: "error" });
        const pass = finalContent.split(" ")[1];
        if (pass !== ADMIN_PASS)
          return socket.emit("systemMessage", { text: "❌ Falsches Passwort.", type: "error" });

        const normalUsers = await User.find({ role: "user" });
        for (const u of normalUsers) {
          await Message.deleteMany({ sender: u.username });
          await User.deleteOne({ username: u.username });
        }
        io.emit("systemMessage", { text: "✅ Alle normalen Nutzer gelöscht.", type: "ok" });
        broadcastActiveUsers();
        return;
      }

      // /reset
      if (finalContent.startsWith("/reset")) {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins.", type: "error" });
        const pass = finalContent.split(" ")[1];
        if (pass !== ADMIN_PASS)
          return socket.emit("systemMessage", { text: "❌ Falsches Passwort.", type: "error" });
        await User.deleteMany({});
        await Message.deleteMany({});
        io.emit("systemMessage", { text: "⚠️ Server wurde zurückgesetzt.", type: "error" });
        io.emit("forceReload", true);
        return;
      }

      socket.emit("systemMessage", { text: `Unbekannter Befehl: ${finalContent}`, type: "info" });
      return;
    }

    // === NORMALE NACHRICHT ===
    if (finalContent.length > 150) finalContent = finalContent.slice(0, 150);
    if (userFilters.get(username)) finalContent = filterMessage(finalContent);

    try {
      const msg = new Message({ sender: username, content: finalContent, senderRole: role });
      await msg.save();

      const deletedIds = await trimOldMessages(100);
      if (deletedIds.length) io.emit("deletedMessages", deletedIds);

      io.emit("newMessage", {
        _id: msg._id,
        sender: msg.sender,
        content: msg.content,
        createdAt: msg.createdAt,
        senderRole: role,
        type: "user",
      });
    } catch (err) {
      console.error("Fehler beim Speichern:", err);
      socket.emit("systemMessage", { text: "Fehler beim Senden.", type: "error" });
    }
  });

  socket.on("toggleFilter", (active) => {
    if (!username) return;
    userFilters.set(username, !!active);
  });
}
