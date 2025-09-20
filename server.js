// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const Message = require("./models/Message");
const User = require("./models/User");
const filterMessage = require("./utils/filter");

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";
const ADMIN_PASS = process.env.ADMIN_PASS || "28102024";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);

mongoose.connect(process.env.MONGO_URI, {})
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch(err => console.error("❌ MongoDB Fehler:", err));

app.use(express.static(path.join(__dirname, "public")));

const activeUsers = new Map();
const userFilters = new Map();
const userRoles = new Map();

// --- Anti-Spam: nur alle 2 Sekunden ---
const lastMessageTime = new Map(); // username → timestamp

function broadcastActiveUsers() {
  const users = Array.from(activeUsers.keys())
    .sort()
    .map(username => ({ username, role: userRoles.get(username) || "user" }));
  io.emit("activeUsers", users);
}

function addActiveUser(username, socketId, role = "user") {
  if (!username) return;
  const set = activeUsers.get(username) || new Set();
  set.add(socketId);
  activeUsers.set(username, set);
  userRoles.set(username, role);
  broadcastActiveUsers();
}

function removeActiveUserBySocket(socketId) {
  for (const [username, set] of activeUsers.entries()) {
    if (set.has(socketId)) {
      set.delete(socketId);
      if (set.size === 0) {
        activeUsers.delete(username);
        userFilters.delete(username);
        userRoles.delete(username);
      } else activeUsers.set(username, set);
      broadcastActiveUsers();
      return username;
    }
  }
  return null;
}

async function trimOldMessages(maxMessages = 100) {
  const count = await Message.countDocuments();
  if (count <= maxMessages) return [];
  const excess = count - maxMessages;
  const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess).select("_id");
  const idsToDelete = oldest.map(d => d._id.toString());
  if (idsToDelete.length) await Message.deleteMany({ _id: { $in: idsToDelete } });
  return idsToDelete;
}

function emitToAdmins(event, payload) {
  for (const [username, sockets] of activeUsers.entries()) {
    const role = userRoles.get(username) || "user";
    if (role === "admin") {
      for (const sid of sockets) io.to(sid).emit(event, payload);
    }
  }
}

// --- SOCKET.IO ---
io.on("connection", async (socket) => {
  let username = null;
  const token = socket.handshake?.auth?.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      username = decoded.username;
      const dbUser = await User.findOne({ username });
      const role = dbUser?.role || "user";
      addActiveUser(username, socket.id, role);
      socket.emit("identified", {
        username,
        filterActive: userFilters.get(username) || false,
        role
      });
    } catch {}
  }

  socket.on("identify", async (payload) => {
    try {
      if (payload?.token) {
        const decoded = jwt.verify(payload.token, JWT_SECRET);
        username = decoded.username;
        const dbUser = await User.findOne({ username });
        const role = dbUser?.role || decoded.role || "user";
        addActiveUser(username, socket.id, role);
        socket.emit("identified", {
          username,
          filterActive: userFilters.get(username) || false,
          role
        });
      } else if (payload?.username) {
        username = payload.username;
        const dbUser = await User.findOne({ username });
        const role = dbUser?.role || "user";
        addActiveUser(username, socket.id, role);
        socket.emit("identified", {
          username,
          filterActive: userFilters.get(username) || false,
          role
        });
      }
    } catch {}
  });

  socket.on("chatMessage", async (content) => {
    if (!username) return;

    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    // --- Anti-Spam: nur alle 2 Sekunden eine Nachricht ---
    const now = Date.now();
    const lastTime = lastMessageTime.get(username) || 0;
    if (now - lastTime < 500) {
      socket.emit("systemMessage", { text: "⚠️ Bitte nicht Nachrichten spammen.", type: "error" });
      return;
    }
    lastMessageTime.set(username, now);

    let finalContent = content.trim();

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
        const newToken = jwt.sign({ username, role }, JWT_SECRET, { expiresIn: "7d" });
        socket.emit("newToken", { token: newToken });
        socket.emit("systemMessage", { text: "✔️ Du bist jetzt Admin.", type: "ok" });
        broadcastActiveUsers();
        emitToAdmins("adminNotice", { text: `${username} ist jetzt Admin.` });
      } else socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
      return;
    }

    // --- /clear ---
    if (finalContent === "/clear") {
      if (role !== "admin")
        return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
      await Message.deleteMany({});
      io.emit("deletedMessages", []); // Clients löschen alle Messages
      io.emit("systemMessage", { text: "⚠️ Alle Nachrichten gelöscht.", type: "error" });
      io.emit("forceReload", false);
      return;
    }

    // --- /deleteAllUsers [passwort] ---
    if (finalContent.startsWith("/deleteAllUsers")) {
      if (role !== "admin")
        return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
      const provided = finalContent.split(" ")[1]?.trim();
      if (provided !== ADMIN_PASS)
        return socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
      await User.deleteMany({ role: "user" });
      for (const uname of userRoles.keys()) {
        const dbu = await User.findOne({ username: uname });
        if (dbu) userRoles.set(uname, dbu.role);
        else userRoles.delete(uname);
      }
      broadcastActiveUsers();
      socket.emit("systemMessage", { text: "✅ Alle normalen Nutzer gelöscht.", type: "ok" });
      emitToAdmins("adminNotice", { text: `${username} hat alle normalen Nutzer gelöscht.` });
      return;
    }

    // --- /reset [passwort] ---
    if (finalContent.startsWith("/reset")) {
      if (role !== "admin")
        return socket.emit("systemMessage", { text: "Nur Admins können diesen Befehl ausführen.", type: "error" });
      const provided = finalContent.split(" ")[1]?.trim();
      if (provided !== ADMIN_PASS)
        return socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
      await User.deleteMany({});
      userRoles.clear();
      activeUsers.clear();
      userFilters.clear();
      await Message.deleteMany({});
      io.emit("systemMessage", { text: "⚠️ Server wurde zurückgesetzt! Alles gelöscht.", type: "error" });
      io.emit("forceReload", true); // true signalisiert: Logout aller Nutzer
      return;
    }

    // --- normale Nachricht ---
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

  socket.on("disconnect", () => removeActiveUserBySocket(socket.id));
});

app.get("/api/messages", async (req, res) => {
  try {
    const msgs = await Message.find().sort({ createdAt: 1 }).limit(100); // direkt chronologisch
    res.json(msgs.map(m => ({
      _id: m._id.toString(),
      sender: m.sender,
      content: m.content,
      createdAt: m.createdAt,
      senderRole: m.senderRole || "user",
      type: "user"
    })));
  } catch {
    res.status(500).json({ error: "Fehler beim Laden der Nachrichten" });
  }
});

// --- Catch-All Route ---
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`✅ Server läuft auf Port ${PORT}`));






