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
const Message = require("./models/Message"); // ensure this exists

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);

// DB connect
mongoose.connect(process.env.MONGO_URI, {})
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch((err) => console.error("❌ MongoDB Fehler:", err));

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// HELPER: trim oldest messages and return array of deleted IDs (strings)
async function trimOldMessages(maxMessages = 100) {
  const count = await Message.countDocuments();
  if (count <= maxMessages) return []; // nothing deleted

  const excess = count - maxMessages;
  const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess).select('_id');
  const idsToDelete = oldest.map(d => d._id.toString()); // strings

  if (idsToDelete.length) {
    const { deletedCount } = await Message.deleteMany({ _id: { $in: idsToDelete } });
    console.log(`🗑️ ${deletedCount} alte Nachrichten gelöscht`);
  }
  return idsToDelete;
}

// Socket.IO: used for broadcasts
io.on('connection', (socket) => {
  // no auth required for simple broadcast; adjust if needed
  socket.on('disconnect', () => {
    // nothing logged
  });
});

// GET messages (return newest first, up to 100)
app.get('/api/messages', async (req, res) => {
  try {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(100);
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Laden der Nachrichten" });
  }
});

// POST messages (protected) -> save, trim old, emit deletions and newMessage
app.post('/api/messages', authMiddleware, async (req, res) => {
  try {
    const msg = new Message({
      sender: req.user.username,
      content: req.body.content
    });
    await msg.save();

    // trim and gather deleted ids
    const deletedIds = await trimOldMessages(100);

    // broadcast deletions first (so clients remove old items)
    if (deletedIds.length) {
      io.emit('deletedMessages', deletedIds); // array of string IDs
    }

    // broadcast the new saved message (send a plain object)
    const payload = {
      _id: msg._id.toString(),
      sender: msg.sender,
      content: msg.content,
      createdAt: msg.createdAt
    };
    io.emit('newMessage', payload);

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
