const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
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

// Middleware
app.use(cors());
app.use(express.json());

//authRoute
app.use("/api/auth", authRoutes);

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
})
    .then(() => console.log("✅ MongoDB verbunden"))
    .catch((err) => console.error("❌ MongoDB Fehler:", err));

// Render stellt die Port-Variable bereit
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Server läuft 🚀");
});

// WICHTIG: an 0.0.0.0 binden
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
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






