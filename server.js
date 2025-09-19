const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const authMiddleware = require("./middleware/auth");
const Message = require("./models/Message");
const User = require("./models/User");

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";
const ADMIN_PASS = "touchingDowniesadmins"; // dein Main Admin Passwort

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);

mongoose.connect(process.env.MONGO_URI, {})
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch(err => console.error("❌ MongoDB Fehler:", err));

app.use(express.static(path.join(__dirname, "public")));

const activeUsers = new Map(); // username -> { sockets: Set, role: "user"|"admin" }

function broadcastActiveUsers() {
  const users = Array.from(activeUsers.entries()).map(([username, data]) => ({
    username,
    role: data.role
  }));
  io.emit("activeUsers", users);
}

function addActiveUser(username, socketId, role = "user") {
  const entry = activeUsers.get(username) || { sockets: new Set(), role };
  entry.sockets.add(socketId);
  entry.role = role; // falls Admin gesetzt
  activeUsers.set(username, entry);
  broadcastActiveUsers();
}

function removeActiveUser(socketId) {
  for (const [username, data] of activeUsers.entries()) {
    if (data.sockets.has(socketId)) {
      data.sockets.delete(socketId);
      if (data.sockets.size === 0) activeUsers.delete(username);
      else activeUsers.set(username, data);
      broadcastActiveUsers();
      return;
    }
  }
}

// --- Socket.IO ---
io.on("connection", (socket) => {
  let username = null;

  socket.on("identify", async (payload) => {
    try {
      if (payload?.token) {
        const decoded = jwt.verify(payload.token, JWT_SECRET);
        username = decoded.username;
        addActiveUser(username, socket.id, decoded.role || "user");
      } else if (payload?.username) {
        username = payload.username;
        addActiveUser(username, socket.id, "user");
      }
      const role = activeUsers.get(username)?.role || "user";
      socket.emit("identified", { username, role });
    } catch {}
  });

  // Admin Command setzen
  socket.on("setAdmin", ({ username, token }) => {
    try {
      if (!username || !token) return;
      const decoded = jwt.verify(token, JWT_SECRET);
      if (username !== decoded.username) return;
      const entry = activeUsers.get(username);
      if (!entry) return;
      entry.role = "admin";
      activeUsers.set(username, entry);
      socket.emit("identified", { username, role: "admin" });
      broadcastActiveUsers();
    } catch {}
  });

  // Chatnachrichten
  socket.on("chatMessage", async (content) => {
    const userEntry = Array.from(activeUsers.entries()).find(([name, data]) => data.sockets.has(socket.id));
    if (!userEntry) return;
    const [user, data] = userEntry;
    const role = data.role;

    // Admin-Befehle nicht an normale User
    if (content.startsWith("/admin") && role !== "admin") return;

    // Speichern
    const msg = new Message({ sender: user, content, role });
    await msg.save();

    io.emit("newMessage", {
      _id: msg._id.toString(),
      sender: msg.sender,
      content: msg.content,
      createdAt: msg.createdAt,
      role
    });
  });

  socket.on("disconnect", () => removeActiveUser(socket.id));
});

app.get("/api/messages", async (req, res) => {
  try {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(100);
    res.json(msgs);
  } catch {
    res.status(500).json({ error: "Fehler beim Laden der Nachrichten" });
  }
});

app.post("/api/messages", authMiddleware, async (req, res) => {
  try {
    const { content } = req.body;
    const username = req.user.username;
    const role = req.user.role || "user";

    const msg = new Message({ sender: username, content, role });
    await msg.save();

    io.emit("newMessage", {
      _id: msg._id.toString(),
      sender: msg.sender,
      content: msg.content,
      createdAt: msg.createdAt,
      role
    });

    res.status(201).json({ _id: msg._id.toString(), sender: msg.sender, content: msg.content, createdAt: msg.createdAt, role });
  } catch {
    res.status(500).json({ error: "Fehler beim Speichern der Nachricht" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`✅ Server läuft auf Port ${PORT}`));

