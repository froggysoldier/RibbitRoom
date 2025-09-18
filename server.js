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
const Message = require("./models/Message"); // Schema für Nachrichten

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
    },
});

// Middleware
app.use(cors());
app.use(express.json());

// Routen
app.use("/api/auth", authRoutes);
app.use("/api/messages", messagesRoutes);

// DB verbinden
mongoose.connect(process.env.MONGO_URI, {})
    .then(() => console.log("✅ MongoDB verbunden"))
    .catch((err) => console.error("❌ MongoDB Fehler:", err));

// Frontend bereitstellen
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Socket.IO
io.on('connection', (socket) => {

    // Nachrichten empfangen
    socket.on('chatMessage', async (msg) => {

        // Neue Nachricht speichern
        const newMsg = new Message(msg);
        await newMsg.save();

        // Alte Nachrichten löschen, wenn mehr als 100
        const count = await Message.countDocuments();
        if (count > 100) {
            const excess = count - 100;
            const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess);
            const idsToDelete = oldest.map(m => m._id);
            await Message.deleteMany({ _id: { $in: idsToDelete } });
        }

        // Nachricht an alle Clients senden
        io.emit('newMessage', newMsg);
    });

    socket.on("disconnect", () => {
        // Kein Logging
    });
});

// Route: Nachrichten holen
app.get('/messages', async (req, res) => {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(1000);
    res.json(msgs);
});

// Route: Nachricht speichern (für eingeloggte Nutzer)
app.post('/messages', authMiddleware, async (req, res) => {
    const msg = new Message({
        sender: req.user.username,
        content: req.body.content
    });
    await msg.save();

    // Alte Nachrichten prüfen
    const count = await Message.countDocuments();
    if (count > 100) {
        const excess = count - 100;
        const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess);
        const idsToDelete = oldest.map(m => m._id);
        await Message.deleteMany({ _id: { $in: idsToDelete } });
    }

    res.status(201).json(msg);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server läuft auf Port ${PORT}`);
});

