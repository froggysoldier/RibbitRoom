const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require('path');
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // später einschränken
    },
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});

// Middleware
app.use(cors());
app.use(express.json());

//authRoute
app.use("/api/auth", authRoutes);

// DB verbinden
mongoose.connect(process.env.MONGO_URI, {
})
    .then(() => console.log("✅ MongoDB verbunden"))
    .catch((err) => console.error("❌ MongoDB Fehler:", err));


// Frontend-Ordner bereitstellen
app.use(express.static(path.join(__dirname, '../client')));

// Socket.IO
io.on('connection', (socket) => {
  console.log('🔌 Nutzer verbunden');
  socket.on('chatMessage', (msg) => {
    io.emit('newMessage', msg);
      socket.on("disconnect", () => {
        console.log("Nutzer getrennt:", socket.id);
  });
});


//html seite laden
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

// Schema für Nachrichten
const messageSchema = new mongoose.Schema({
    sender: String,
    content: String,
    createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model("Message", messageSchema);

// Route: Nachrichten holen
app.get('/messages', async (req, res) => {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(20);
    res.json(msgs);
});

// Route: Nachricht speichern
app.post('/messages', async (req, res) => {
    const msg = new Message(req.body);
    await msg.save();
    res.status(201).json(msg);
});











