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
const messagesRoutes = require("./routes/messages");
const Message = require("./models/Message"); // <-- sicherstellen, dass dieses Model existiert

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // später einschränken
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Auth- & Message-Routen (falls messagesRoutes eigene Routen hat)
app.use("/api/auth", authRoutes);
app.use("/api/messages", messagesRoutes);

// DB verbinden
mongoose.connect(process.env.MONGO_URI, {})
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch((err) => console.error("❌ MongoDB Fehler:", err));

// Frontend-Ordner bereitstellen
app.use(express.static(path.join(__dirname, "public")));

// Hilfsfunktion: alte Nachrichten trimmen, so dass maxMessages übrig bleiben
async function trimOldMessages(maxMessages = 100) {
  const count = await Message.countDocuments();
  if (count <= maxMessages) return;

  const excess = count - maxMessages;
  // finde die ältesten 'excess' Dokumente und lösche sie
  const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess).select('_id');
  const idsToDelete = oldest.map(d => d._id);
  if (idsToDelete.length) {
    await Message.deleteMany({ _id: { $in: idsToDelete } });
    console.log(`🗑️ ${idsToDelete.length} alte Nachrichten gelöscht`);
  }
}

// Socket.io
io.on('connection', (socket) => {
  // Keine ausführlichen Logs hier (nur Verbindung/Trennung if wanted)
  socket.on('chatMessage', async (data) => {
    try {
      let newMsg;
      if (data._id) {
        newMsg = await Message.findById(data._id) || data;
      } else {
        newMsg = new Message({
          sender: data.sender || "Unbekannt",
          content: data.content
        });
        await newMsg.save();
      }

      // trim die DB auf max 100
      await trimOldMessages(100);

      // Broadcast an alle Clients (inkl. createdAt, _id)
      io.emit('newMessage', {
        _id: newMsg._id,
        sender: newMsg.sender,
        content: newMsg.content,
        createdAt: newMsg.createdAt
      });
    } catch (err) {
      console.error("Fehler beim Verarbeiten der chatMessage:", err.message);
    }
  });

  socket.on("disconnect", () => {
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Route: Nachrichten holen (liefere die neuesten 100, sortiert newest first)
app.get('/messages', async (req, res) => {
  try {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(100);
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Laden der Nachrichten" });
  }
});

// Route: Nachricht speichern (nur für eingeloggte Nutzer, REST)
// Diese Route speichert die Nachricht, trimmt und gibt das gespeicherte Objekt zurück
app.post('/messages', authMiddleware, async (req, res) => {
  try {
    const msg = new Message({
      sender: req.user.username,
      content: req.body.content
    });
    await msg.save();

    // max 100 behalten
    await trimOldMessages(100);

    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Speichern der Nachricht" });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});


