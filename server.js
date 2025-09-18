// server.js
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
const io = new Server(server, {
  cors: { origin: "*" } // production: restrict allowed origins
});

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error("Not allowed by CORS"));
  }
}));

const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN }
});

// Middleware
app.use(express.json());
app.use("/api/auth", authRoutes);

// MongoDB verbinden
mongoose.connect(process.env.MONGO_URI, {})
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch(err => console.error("❌ MongoDB Fehler:", err));

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// ------- Active users -------
const activeUsers = new Map();

function broadcastActiveUsers() {
  io.emit("activeUsers", Array.from(activeUsers.keys()).sort());
}

function addActiveUser(username, socketId) {
  if (!username) return;
  const set = activeUsers.get(username) || new Set();
  set.add(socketId);
  activeUsers.set(username, set);
  broadcastActiveUsers();
}

function removeActiveUserBySocket(socketId) {
  for (const [username, set] of activeUsers.entries()) {
    if (set.has(socketId)) {
      set.delete(socketId);
      if (set.size === 0) activeUsers.delete(username);
      else activeUsers.set(username, set);
      broadcastActiveUsers();
      return username;
    }
  }
  return null;
}

// ------- Alte Nachrichten trimmen -------
async function trimOldMessages(maxMessages = 100) {
  const count = await Message.estimatedDocumentCount();
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

// ------- Socket.IO -------
io.on("connection", (socket) => {
  const token = socket.handshake?.auth?.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      addActiveUser(decoded.username, socket.id);
      socket.emit("identified", { username: decoded.username });
    } catch { /* invalid token */ }
  }

  socket.on("identify", payload => {
    try {
      if (payload?.token) {
        const decoded = jwt.verify(payload.token, JWT_SECRET);
        addActiveUser(decoded.username, socket.id);
        socket.emit("identified", { username: decoded.username });
      } else if (payload?.username) {
        addActiveUser(payload.username, socket.id);
        socket.emit("identified", { username: payload.username });
      }
    } catch { }
  });

  socket.on("disconnect", () => removeActiveUserBySocket(socket.id));
});

// ------- REST: Nachrichten -------
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
      content: req.body.content
    });
    await msg.save();

    const deletedIds = await trimOldMessages(100);

    if (deletedIds.length) io.emit("deletedMessages", deletedIds);

    const payload = {
      _id: msg._id.toString(),
      sender: msg.sender,
      content: msg.content,
      createdAt: msg.createdAt
    };
    io.emit("newMessage", payload);

    res.status(201).json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Speichern der Nachricht" });
  }
});

// Fallback für SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`✅ Server läuft auf Port ${PORT}`));
