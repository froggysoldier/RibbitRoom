// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require('path');
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const authMiddleware = require("./middleware/auth");
const Message = require("./models/Message"); // ensure this file exists and exports the model

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } // production: restrict origin
});

// Middleware
app.use(cors());
app.use(express.json());

// Auth-Routes
app.use("/api/auth", authRoutes);

// DB verbinden
mongoose.connect(process.env.MONGO_URI, {})
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch((err) => console.error("❌ MongoDB Fehler:", err));

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// Helper: trim oldest messages so that at most maxMessages remain
async function trimOldMessages(maxMessages = 100) {
  const count = await Message.countDocuments();
  if (count <= maxMessages) return 0;
  const excess = count - maxMessages;
  const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess).select('_id');
  const idsToDelete = oldest.map(d => d._id);
  if (idsToDelete.length) {
    const { deletedCount } = await Message.deleteMany({ _id: { $in: idsToDelete } });
    console.log(`🗑️ ${deletedCount} alte Nachrichten gelöscht`);
    return deletedCount;
  }
  return 0;
}

// Socket.IO: clients connect to receive broadcasts
io.on('connection', (socket) => {
  // optional: console.log(`socket connected: ${socket.id}`);
  socket.on('disconnect', () => {
    // optional: console.log(`socket disconnected: ${socket.id}`);
  });
});

// REST: get messages (public; returns newest first)
app.get('/api/messages', async (req, res) => {
  try {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(100); // deliver up to 100 newest
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Laden der Nachrichten" });
  }
});

// REST: post message (protected) - saves, trims, broadcasts
app.post('/api/messages', authMiddleware, async (req, res) => {
  try {
    const msg = new Message({
      sender: req.user.username,
      content: req.body.content
    });
    await msg.save();

    // Trim DB to max 100 messages
    await trimOldMessages(100);

    // Broadcast the saved message to all connected clients
    io.emit('newMessage', msg);

    res.status(201).json(msg);
  } catch (err) {
    console.error("Fehler beim Speichern:", err);
    res.status(500).json({ error: "Fehler beim Speichern der Nachricht" });
  }
});

// Fallback to index.html for SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
