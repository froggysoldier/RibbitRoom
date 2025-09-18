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
    cors: { origin: "*" }
});

// Middleware
app.use(cors());
app.use(express.json());

// Auth-Routen
app.use("/api/auth", authRoutes);

// DB verbinden
mongoose.connect(process.env.MONGO_URI, {})
    .then(() => console.log("✅ MongoDB verbunden"))
    .catch(err => console.error("❌ MongoDB Fehler:", err));

// Frontend bereitstellen
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Socket.IO für eingeloggte Nutzer
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Nicht authentifiziert"));

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.user = decoded; // Benutzerinfo speichern
        next();
    } catch (err) {
        next(new Error("Ungültiger Token"));
    }
});

io.on('connection', (socket) => {
    // Nachricht empfangen
    socket.on('chatMessage', async (data) => {
        try {
            const sender = socket.user.username; // immer authentifizierter Nutzer

            const newMsg = new Message({
                sender,
                content: data.content
            });
            await newMsg.save();

            // Maximal 100 Nachrichten behalten
            const count = await Message.countDocuments();
            if (count > 100) {
                const excess = count - 100;
                const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess);
                const idsToDelete = oldest.map(m => m._id);
                await Message.deleteMany({ _id: { $in: idsToDelete } });
            }

            io.emit('newMessage', newMsg);

        } catch (err) {
            console.error(err);
        }
    });
});

// Alle Nachrichten abrufen
app.get('/messages', authMiddleware, async (req, res) => {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(100);
    res.json(msgs);
});

// Nachricht speichern (REST) nur für eingeloggte Nutzer
app.post('/messages', authMiddleware, async (req, res) => {
    try {
        const msg = new Message({
            sender: req.user.username,
            content: req.body.content
        });
        await msg.save();

        // Maximal 100 Nachrichten behalten
        const count = await Message.countDocuments();
        if (count > 100) {
            const excess = count - 100;
            const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess);
            const idsToDelete = oldest.map(m => m._id);
            await Message.deleteMany({ _id: { $in: idsToDelete } });
        }

        res.status(201).json(msg);
    } catch (err) {
        res.status(500).json({ error: "Fehler beim Speichern der Nachricht" });
    }
});

// Server starten
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server läuft auf Port ${PORT}`);
});
