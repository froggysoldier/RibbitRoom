// sockets/handlers/chatMessageHandler.js
const jwt = require("jsonwebtoken");
const Message = require("../../models/Message");
const User = require("../../models/User");
const filterMessage = require("../../utils/filter");

module.exports = function (socket, ctx) {
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
    io,
  } = ctx;

  // --- Hilfsfunktionen ---
  const normalize = (u) => String(u || "").trim().toLowerCase();

  // Serverweite Maps
  ctx.userTimeouts = ctx.userTimeouts || new Map();
  ctx.messageHistory = ctx.messageHistory || new Map();
  ctx.timeoutIntervals = ctx.timeoutIntervals || new Map();

  const userTimeouts = ctx.userTimeouts;
  const messageHistory = ctx.messageHistory;
  const timeoutIntervals = ctx.timeoutIntervals;

  const findActiveSocketsFor = (targetNorm) => {
    for (const [uname, socketsSet] of activeUsers.entries()) {
      if (normalize(uname) === targetNorm) return socketsSet;
    }
    return null;
  };

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

  // --- Chat Message Handler ---
  socket.on("chatMessage", async (content) => {
    if (!username) return;

    const now = Date.now();
    const myNorm = normalize(username);

    // 🔒 --- STRIKTER TIMEOUT-CHECK ---
    const timeoutUntil = userTimeouts.get(myNorm);
    if (timeoutUntil && now < timeoutUntil) {
      const remainingSec = Math.ceil((timeoutUntil - now) / 1000);
      socket.emit("systemMessage", {
        text: `⚠️ Du bist noch für ${formatDuration(remainingSec)} gemutet und darfst nichts schreiben.`,
        type: "error",
      });

      // interne Schutzmarkierung
      socket._isMuted = true;
      return; // blockiert 100 %
    } else {
      socket._isMuted = false;
    }

    if (socket._isMuted) return;

    // --- Anti-Spam ---
    const MIN_INTERVAL = 350;
    const lastTime = lastMessageTime.get(username) || 0;
    if (now - lastTime < MIN_INTERVAL) {
      lastMessageTime.set(username, now);
      return socket.emit("systemMessage", {
        text: "⚠️ Bitte keine Nachrichten spammen.",
        type: "error",
        duration: 1500,
      });
    }
    lastMessageTime.set(username, now);

    const HISTORY_LIMIT = 7;
    const TIME_WINDOW = 10000;
    const hist = messageHistory.get(myNorm) || [];
    const recent = hist.filter((ts) => now - ts <= TIME_WINDOW);
    recent.push(now);
    messageHistory.set(myNorm, recent);
    if (recent.length > HISTORY_LIMIT) {
      socket.emit("systemMessage", {
        text: "⚠️ Du sendest zu schnell Nachrichten. Bitte warte kurz.",
        type: "error",
        duration: 4000,
      });
      return;
    }

    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    let finalContent = (content || "").trim();

    // --- Befehle ---
    if (finalContent.startsWith("/")) {
      // 🔹 /help
      if (finalContent === "/help") {
        socket.emit("systemMessage", {
          text: `
ℹ️ **Verfügbare Befehle:**
/admin [passwort] → Admin werden
/ban "username" [passwort] → User bannen
/timeout "username" sek → User muten
/clear → Chat leeren (Admins)
/deleteAllUsers [passwort] → Alle normalen User löschen
/reset [passwort] → Server zurücksetzen
/listUsers → Zeigt alle Online-User
/role → Zeigt deine Rolle
/help → Zeigt diese Liste
          `.trim(),
          type: "info",
          duration: 15000,
        });
        return;
      }

      // 🔹 /role
      if (finalContent === "/role") {
        socket.emit("systemMessage", {
          text: `ℹ️ Deine Rolle ist: ${role}`,
          type: "info",
        });
        return;
      }

      // 🔹 /admin
      const adminMatch = finalContent.match(/^\/admin\s*(.*)$/i);
      if (adminMatch) {
        const provided = (adminMatch[1] || "").trim();
        if (provided === ADMIN_PASS) {
          role = "admin";
          if (dbUser) {
            dbUser.role = "admin";
            await dbUser.save();
          }
          userRoles.set(username, "admin");
          const newToken = jwt.sign({ username, role }, JWT_SECRET, { expiresIn: "7d" });
          socket.emit("newToken", { token: newToken });
          socket.emit("systemMessage", { text: "✔️ Du bist jetzt Admin.", type: "ok" });
        } else {
          socket.emit("systemMessage", { text: "❌ Falsches Passwort.", type: "error" });
        }
        return;
      }

      // 🔹 /clear
      if (finalContent === "/clear") {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins dürfen das.", type: "error" });
        await Message.deleteMany({});
        io.emit("deletedMessages", []);
        io.emit("systemMessage", { text: "⚠️ Alle Nachrichten gelöscht!", type: "error" });
        return;
      }

      // 🔹 /listUsers
      if (finalContent === "/listUsers") {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins.", type: "error" });
        const list = Array.from(activeUsers.keys())
          .map((u) => {
            const isMuted =
              userTimeouts.has(normalize(u)) && userTimeouts.get(normalize(u)) > Date.now();
            const r = userRoles.get(u) || "user";
            return `${u} (${r}${isMuted ? ", gemutet" : ""})`;
          })
          .join("\n");
        socket.emit("systemMessage", { text: `👥 Online-User:\n${list}`, type: "info" });
        return;
      }

      // 🔹 /ban
      const banMatch = finalContent.match(/^\/ban\s+(?:"([^"]+)"|(\S+))\s+(\S+)/i);
      if (banMatch) {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins.", type: "error" });
        const target = (banMatch[1] || banMatch[2]).trim();
        const pass = banMatch[3];
        if (pass !== ADMIN_PASS)
          return socket.emit("systemMessage", { text: "Falsches Passwort.", type: "error" });
        if (normalize(target) === myNorm)
          return socket.emit("systemMessage", {
            text: "Du kannst dich nicht selbst bannen.",
            type: "error",
          });

        await User.findOneAndDelete({ username: target });
        await Message.deleteMany({ sender: target });
        const sockets = findActiveSocketsFor(normalize(target));
        if (sockets) {
          for (const sid of sockets) {
            io.to(sid).emit("banned", { text: "Du wurdest gebannt." });
            io.sockets.sockets.get(sid)?.disconnect(true);
          }
          activeUsers.delete(target);
          userRoles.delete(target);
        }
        io.emit("systemMessage", { text: `🚫 ${target} wurde gebannt.`, type: "error" });
        return;
      }

      // 🔹 /timeout
      const timeoutMatch = finalContent.match(/^\/timeout\s+(?:"([^"]+)"|(\S+))\s+(\d+)/i);
      if (timeoutMatch) {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins.", type: "error" });
        const target = (timeoutMatch[1] || timeoutMatch[2]).trim();
        let durationSec = parseInt(timeoutMatch[3], 10);
        if (!durationSec || durationSec <= 0)
          return socket.emit("systemMessage", { text: "Ungültige Zeit.", type: "error" });

        const until = Date.now() + durationSec * 1000;
        userTimeouts.set(normalize(target), until);

        const sockets = findActiveSocketsFor(normalize(target));
        if (sockets) {
          for (const sid of sockets) {
            const s = io.sockets.sockets.get(sid);
            if (s) {
              s._isMuted = true;
              s.emit("timeoutUpdate", {
                text: `⚠️ Du bist gemutet für ${formatDuration(durationSec)}.`,
              });
              const interval = setInterval(() => {
                const remaining = Math.ceil((until - Date.now()) / 1000);
                if (remaining <= 0) {
                  clearInterval(interval);
                  userTimeouts.delete(normalize(target));
                  s._isMuted = false;
                  s.emit("timeoutUpdate", { text: "✔️ Du kannst wieder schreiben." });
                }
              }, 1000);
              timeoutIntervals.set(normalize(target), interval);
            }
          }
        }

        io.emit("systemMessage", {
          text: `⏳ ${target} wurde für ${formatDuration(durationSec)} gemutet.`,
          type: "error",
        });
        return;
      }

      // 🔹 /deleteAllUsers
      if (finalContent.startsWith("/deleteAllUsers")) {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins.", type: "error" });
        const provided = finalContent.split(" ")[1];
        if (provided !== ADMIN_PASS)
          return socket.emit("systemMessage", { text: "❌ Falsches Passwort.", type: "error" });
        await User.deleteMany({ role: "user" });
        await Message.deleteMany({});
        io.emit("systemMessage", {
          text: "⚠️ Alle normalen Nutzer wurden gelöscht.",
          type: "error",
        });
        io.emit("forceReload");
        return;
      }

      // 🔹 /reset
      if (finalContent.startsWith("/reset")) {
        if (role !== "admin")
          return socket.emit("systemMessage", { text: "Nur Admins.", type: "error" });
        const provided = finalContent.split(" ")[1];
        if (provided !== ADMIN_PASS)
          return socket.emit("systemMessage", { text: "❌ Falsches Passwort.", type: "error" });
        await User.deleteMany({});
        await Message.deleteMany({});
        userRoles.clear();
        activeUsers.clear();
        io.emit("systemMessage", { text: "⚠️ Server wurde zurückgesetzt!", type: "error" });
        io.emit("forceReload");
        return;
      }

      // 🔹 Unbekannt
      socket.emit("systemMessage", { text: `❓ Unbekanntes Kommando: ${finalContent}`, type: "info" });
      return;
    }

    // --- Normale Nachricht ---
    if (finalContent.length > 150) finalContent = finalContent.slice(0, 150);
    if (userFilters.get(username)) finalContent = filterMessage(finalContent);

    try {
      const msg = new Message({ sender: username, content: finalContent, senderRole: role });
      await msg.save();

      const deletedIds = await trimOldMessages(100);
      if (deletedIds.length)
        for (const sid of authenticatedSockets) io.to(sid).emit("deletedMessages", deletedIds);

      for (const sid of authenticatedSockets) {
        io.to(sid).emit("newMessage", {
          _id: msg._id.toString(),
          sender: msg.sender,
          content: msg.content,
          senderRole: role,
          createdAt: msg.createdAt,
        });
      }
    } catch (err) {
      console.error("Message Fehler:", err);
      socket.emit("systemMessage", { text: "Fehler beim Senden.", type: "error" });
    }
  });

  // Filter toggeln
  socket.on("toggleFilter", (active) => {
    if (username) userFilters.set(username, !!active);
  });

  socket.on("disconnect", () => {
    const norm = normalize(username);
    const int = timeoutIntervals.get(norm);
    if (int) clearInterval(int);
    timeoutIntervals.delete(norm);
  });
};
