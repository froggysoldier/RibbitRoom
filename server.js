const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require('path');
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const authMiddleware = require("./middleware/auth");
const Message = require("./models/Message");

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Middleware
app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);

// DB verbinden
mongoose.connect(process.env.MONGO_URI, {})
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch((err) => console.error("❌ MongoDB Fehler:", err));

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// Active Users
const activeUsers = new Map();
function broadcastActiveUsers() {
  const users = Array.from(activeUsers.entries()).map(([username, info]) => ({
    username,
    role: info.role
  })).sort((a,b) => a.username.localeCompare(b.username));
  io.emit("activeUsers", users);
}
function addActiveUser(username, role, socketId) {
  if (!username) return;
  activeUsers.set(username, { role, socketId });
  broadcastActiveUsers();
}
function removeActiveUserBySocket(socketId) {
  for (const [username, info] of activeUsers.entries()) {
    if (info.socketId === socketId) {
      activeUsers.delete(username);
      broadcastActiveUsers();
      return username;
    }
  }
  return null;
}

// Trim oldest messages
async function trimOldMessages(maxMessages = 100) {
  const count = await Message.countDocuments();
  if (count <= maxMessages) return [];
  const excess = count - maxMessages;
  const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess).select('_id');
  const idsToDelete = oldest.map(d => d._id.toString());
  if (idsToDelete.length) {
    const { deletedCount } = await Message.deleteMany({ _id: { $in: idsToDelete } });
    console.log(`🗑️ ${deletedCount} alte Nachrichten gelöscht`);
  }
  return idsToDelete;
}

// Socket.IO
io.on("connection", (socket) => {
  const token = socket.handshake?.auth?.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      addActiveUser(decoded.username, decoded.role || "user", socket.id);
      socket.emit("identified", { username: decoded.username, role: decoded.role });
    } catch {}
  }

  socket.on("identify", (payload) => {
    try {
      if (payload?.token) {
        const decoded = jwt.verify(payload.token, JWT_SECRET);
        addActiveUser(decoded.username, decoded.role || "user", socket.id);
        socket.emit("identified", { username: decoded.username, role: decoded.role });
      } else if (payload?.username) {
        addActiveUser(payload.username, "user", socket.id);
        socket.emit("identified", { username: payload.username, role: "user" });
      }
    } catch {}
  });

  socket.on("chatMessage", (data) => io.emit("newMessage", data));

  socket.on("disconnect", () => removeActiveUserBySocket(socket.id));
});

// REST Messages
app.get("/api/messages", async (req, res) => {
  try {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(100);
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Laden der Nachrichten" });
  }
});

app.post("/api/messages", authMiddleware, async (req, res) => {
  try {
    const msg = new Message({
      sender: req.user.username,
      content: req.body.content,
      role: req.user.role || "user"
    });
    await msg.save();

    const deletedIds = await trimOldMessages(100);
    if (deletedIds.length) io.emit("deletedMessages", deletedIds);

    const payload = {
      _id: msg._id.toString(),
      sender: msg.sender,
      content: msg.content,
      createdAt: msg.createdAt,
      role: msg.role
    };
    io.emit("newMessage", payload);
    res.status(201).json(payload);
  } catch (err) {
    console.error("Fehler beim Speichern:", err);
    res.status(500).json({ error: "Fehler beim Speichern der Nachricht" });
  }
});

// Fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`✅ Server läuft auf Port ${PORT}`));
