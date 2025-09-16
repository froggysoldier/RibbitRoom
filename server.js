const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

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

// Testroute
app.get("/", (req, res) => {
    res.send("Chatroom Backend läuft 🚀");
});

// Socket.IO
io.on("connection", (socket) => {
    console.log("Ein Nutzer verbunden:", socket.id);

    socket.on("disconnect", () => {
        console.log("Nutzer getrennt:", socket.id);
    });
});

// DB verbinden
mongoose.connect(process.env.MONGO_URI, {
 useNewUrlParser: true, 
  useUnifiedTopology: true 
})
    .then(() => console.log("✅ MongoDB verbunden"))
    .catch((err) => console.error("❌ MongoDB Fehler:", err));

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


