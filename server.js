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
const filterMessage = require("./utils/filter");

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";
const DELETE_PASS = "admin123"; // Passwort für /delete all users

// Farben für Logs
const colors = {
  reset: "\x1b[0m",
  fgRed: "\x1b[31m",
  fgGreen: "\x1b[32m",
  fgYellow: "\x1b[33m",
  fgCyan: "\x1b[36m"
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);

mongoose.connect(process.env.MONGO_URI, {})
  .then(() => console.log(`${colors.fgGreen}✅ MongoDB verbunden${colors.reset}`))
  .catch(err => console.error(`${colors.fgRed}❌ MongoDB Fehler:${err}${colors.reset}`));

app.use(express.static(path.join(__dirname, "public")));

const activeUsers = new Map();
const userFilters = new Map(); // username -> filter aktiv?

function broadcastActiveUsers() {
  const users = Array.from(activeUsers.keys()).sort().map(username => ({ username }));
  io.emit("activeUsers", users);
}

function addActiveUser(username, socketId) {
  if (!username) return;
  const set = activeUsers.get(username) || new Set();
  const isNewUser = set.size === 0;
  set.add(socketId);
  activeUsers.set(username, set);
  if (isNewUser) console.log(`${colors.fgGreen}[SERVER] User online: ${username}${colors.reset}`);
  broadcastActiveUsers();
}

function removeActiveUserBySocket(socketId) {
  for (const [username, set] of activeUsers.entries()) {
    if (set.has(socketId)) {
      set.delete(socketId);
      if (set.size === 0) {
        activeUsers.delete(username);
        userFilters.delete(username);
        console.log(`${colors.fgRed}[SERVER] User offline: ${username}${colors.reset}`);
      } else activeUsers.set(username, set);
      broadcastActiveUsers();
      return username;
    }
  }
  return null;
}

async function trimOldMessages(maxMessages = 100) {
  const count = await Message.countDocuments();
  if (count <= maxMessages) return [];
  const excess = count - maxMessages;
  const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess).select("_id");
  const idsToDelete = oldest.map(d => d._id.toString());
  if (idsToDelete.length) {
    await Message.deleteMany({ _id: { $in: idsToDelete } });
    console.log(`${colors.fgYellow}[SERVER] Alte Nachrichten gelöscht: ${idsToDelete.length}${colors.reset}`);
  }
  return idsToDelete;
}

// --- Socket.io ---
io.on("connection", (socket) => {
  let username = null;
  const token = socket.handshake?.auth?.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      username = decoded.username;
      addActiveUser(username, socket.id);
      socket.emit("identified", { username, filterActive: userFilters.get(username) || false });
    } catch {}
  }

  socket.on("identify", payload => {
    try {
      if (payload?.token) {
        const decoded = jwt.verify(payload.token, JWT_SECRET);
        username = decoded.username;
      } else if (payload?.username) {
        username = payload.username;
      }
      if (username) {
        addActiveUser(username, socket.id);
        socket.emit("identified", { username, filterActive: userFilters.get(username) || false });
      }
    } catch {}
  });

  socket.on("chatMessage", async (content) => {
    if (!username) return;

    // --- Command: alle User löschen ---
    if (content === `/delete all users : ${DELETE_PASS}`) {
      await User.deleteMany({});
      io.emit("newMessage", {
        sender: "SYSTEM",
        content: "✅ Alle User wurden gelöscht!",
        createdAt: new Date(),
        _id: "system"
      });
      return;
    }

    if (content.length > 150) content = content.slice(0, 150);
    if (userFilters.get(username)) content = filterMessage(content);

    try {
      const msg = new Message({ sender: username, content });
      await msg.save();
      const deletedIds = await trimOldMessages(100);
      if (deletedIds.length) io.emit("deletedMessages", deletedIds);

      io.emit("newMessage", {
        _id: msg._id.toString(),
        sender: msg.sender,
        content: msg.content,
        createdAt: msg.createdAt
      });
    } catch {
      socket.emit("info", "Fehler beim Senden der Nachricht");
    }
  });

  socket.on("toggleFilter", active => {
    if (!username) return;
    userFilters.set(username, !!active);
  });

  socket.on("disconnect", () => {
    removeActiveUserBySocket(socket.id);
  });
});

// --- API ---
app.get("/api/messages", async (req, res) => {
  try {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(100);
    res.json(msgs);
  } catch {
    res.status(500).json({ error: "Fehler beim Laden der Nachrichten" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`${colors.fgGreen}✅ Server läuft auf Port ${PORT}${colors.reset}`));
