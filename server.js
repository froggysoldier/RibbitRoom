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
const messagesRoutes = require("./routes/messages");
const Message = require("./models/Message"); // Schema für Nachrichten

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

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
    // Token vom Client
    const token = socket.handshake.auth.token;
    let username = "Unbekannt";

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        username = decoded.username;
        console.log(`🔌 Nutzer verbunden: ${username} (${socket.id})`);
    } catch (err) {
        console.log("⚠️ Ungültiger Token, Verbindung ohne Username");
    }

    // Nachrichten empfangen
    socket.on('chatMessage', async (data) => {
        try {
            // Optional: Token nochmal prüfen
            const decoded = jwt.verify(data.token, JWT_SECRET);
            const sender = decoded.username;

            const msg = new Message({
                sender: sender,
                content: data.content
            });
            await msg.save();

            console.log(`💬 Nachricht von ${sender}: ${data.content}`);

            io.emit('newMessage', {
                sender: sender,
                content: data.content,
                createdAt: msg.createdAt
            });
        } catch (err) {
            console.log("⚠️ Ungültiger Token bei Nachricht:", err.message);
        }
    });

    socket.on("disconnect", () => {
        console.log(`❌ Nutzer getrennt: ${username} (${socket.id})`);
    });
});

// Server starten
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server läuft auf Port ${PORT}`);
});
