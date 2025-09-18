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

// Middleware
app.use(cors());
app.use(express.json());

// Auth routes
app.use("/api/auth", authRoutes);

// DB verbinden
mongoose.connect(process.env.MONGO_URI, {})
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch((err) => console.error("❌ MongoDB Fehler:", err));

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// ------- Active users management -------
/** Map username -> Set(socketId) */
const activeUsers = new Map();

function broadcastActiveUsers() {
  const users = Array.from(activeUsers.keys()).sort();
  io.emit("activeUsers", users);
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

// ------- Helper: trim oldest messages to keep maxMessages in DB -------
async function trimOldMessages(maxMessages = 100) {
  const count = await Message.countDocuments();
  if (count <= maxMessages) return [];
  const excess = count - maxMessages;
  const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess).select('_id');
  const idsToDelete = oldest.map(d => d._id.toString());
  if (idsToDelete.length) {
    const { deletedCount } = await Message.deleteMany({ _id: { $in: idsToDelete } });
    // optional minimal logging
    console.log(`🗑️ ${deletedCount} alte Nachrichten gelöscht`);
  }
  return idsToDelete;
}

// ------- Socket.IO -------
io.on("connection", (socket) => {
  // Try to identify user from handshake token (if client sent it)
  const token = socket.handshake?.auth?.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      addActiveUser(decoded.username, socket.id);
      // confirm identification
      socket.emit("identified", { username: decoded.username });
    } catch (err) {
      // invalid token -> ignore identification
    }
  }

  // client can identify later (e.g. after login) by sending token or username
  socket.on("identify", (payload) => {
    try {
      if (payload?.token) {
        const decoded = jwt.verify(payload.token, JWT_SECRET);
        addActiveUser(decoded.username, socket.id);
        socket.emit("identified", { username: decoded.username });
      } else if (payload?.username) {
        addActiveUser(payload.username, socket.id);
        socket.emit("identified", { username: payload.username });
      }
    } catch (err) {
      // ignore
    }
  });

  // Keep socket for broadcasts; we prefer REST POST to save messages
  socket.on("chatMessage", (data) => {
    // Optional: if clients emit chatMessage directly, we could broadcast it without saving.
    // However recommended flow: client POSTs to /api/messages and server broadcasts the saved msg.
    io.emit("newMessage", data);
  });

  socket.on("disconnect", () => {
    removeActiveUserBySocket(socket.id);
  });
});

// ------- REST: messages -------
// GET messages (return newest first, up to 100)
app.get("/api/messages", async (req, res) => {
  try {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(100);
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Laden der Nachrichten" });
  }
});

// POST message (protected) -> save, trim old, emit deletions and newMessage
app.post("/api/messages", authMiddleware, async (req, res) => {
  try {
    const msg = new Message({
      sender: req.user.username,
      content: req.body.content
    });
    await msg.save();

    // trim DB and get deleted IDs
    const deletedIds = await trimOldMessages(100);

    // broadcast deleted IDs so clients remove DOM nodes
    if (deletedIds.length) io.emit("deletedMessages", deletedIds);

    // broadcast saved message
    const payload = {
      _id: msg._id.toString(),
      sender: msg.sender,
      content: msg.content,
      createdAt: msg.createdAt
    };
    io.emit("newMessage", payload);

    res.status(201).json(payload);
  } catch (err) {
    console.error("Fehler beim Speichern:", err);
    res.status(500).json({ error: "Fehler beim Speichern der Nachricht" });
  }
});

// Fallback to index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
