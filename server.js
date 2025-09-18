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

//authRoute
app.use("/api/auth", authRoutes);
//MessageRoute
app.use("/api/messages", messagesRoutes);

// DB verbinden
mongoose.connect(process.env.MONGO_URI, {
})
    .then(() => console.log("✅ MongoDB verbunden"))
    .catch((err) => console.error("❌ MongoDB Fehler:", err));


// Frontend-Ordner bereitstellen
app.use(express.static(path.join(__dirname, "public")));


//Socket.io
io.on('connection', (socket) => {
  console.log('🔌 Nutzer verbunden');

  socket.on('chatMessage', (msg) => {
    io.emit('newMessage', msg);
  });

  socket.on("disconnect", () => {
    console.log("Nutzer getrennt:", socket.id);
  });
});


//html seite laden
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


// Route: Nachrichten holen
app.get('/messages', async (req, res) => {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(100); 
    res.json(msgs);
});

// Route: Nachricht speichern
app.post('/messages', async (req, res) => {
    const msg = new Message(req.body);
    await msg.save();
    res.status(201).json(msg);
});

// Nachrichten speichern – nur für eingeloggte Nutzer
app.post('/messages', authMiddleware, async (req, res) => {
    const msg = new Message({
        sender: req.user.username, // aus Token
        content: req.body.content
    });
    await msg.save();
    res.status(201).json(msg);
});



const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});




