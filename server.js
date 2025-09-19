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
const adminMiddleware = require("./middleware/admin");
const Message = require("./models/Message");
const User = require("./models/User");
const filterMessage = require("./utils/filter");

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";
const DEBUG = false;

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
  .catch(err => console.error(`${colors.fgRed}❌ MongoDB Fehler: ${err}${colors.reset}`));

app.use(express.static(path.join(__dirname, "public")));

const activeUsers = new Map();
const userFilters = new Map(); // username -> filter aktiv?
const adminSockets = new Set(); // socket.id von Admins

function broadcastActiveUsers() {
  const users = Array.from(activeUsers.keys())
    .sort()
    .map(username => ({ username }));
  io.emit("activeUsers", users);
}

function addActiveUser(username, socketId, isAdmin=false) {
  if (!username) return;
  const set = activeUsers.get(username) || new Set();
  const isNewUser = set.size === 0;
  set.add(socketId);
  activeUsers.set(username, set);
  if (isAdmin) adminSockets.add(socketId);
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
      break;
    }
  }
  adminSockets.delete(socketId);
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

io.on("connection", (socket) => {
  if (DEBUG) console.log(`${colors.fgCyan}[SOCKET] Client verbunden: ${socket.id}${colors.reset}`);

  let username = null;
  let isAdmin = false;
  const token = socket.handshake?.auth?.token;

  // Auto-Identifikation via Token
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      username = decoded.username;
      isAdmin = decoded.role === "admin";
      addActiveUser(username, socket.id, isAdmin);
      socket.emit("identified", { username, filterActive: userFilters.get(username) || false, role: decoded.role });
      if (DEBUG) console.log(`${colors.fgCyan}[SOCKET] User automatisch identifiziert: ${username}${colors.reset}`);
    } catch {}
  }

  socket.on("identify", payload => {
    try {
      if (payload?.token) {
        const decoded = jwt.verify(payload.token, JWT_SECRET);
        username = decoded.username;
        isAdmin = decoded.role === "admin";
      } else if (payload?.username) {
        username = payload.username;
      }
      if (username) {
        addActiveUser(username, socket.id, isAdmin);
        socket.emit("identified", { username, filterActive: userFilters.get(username) || false, role: isAdmin ? "admin" : "user" });
        console.log(`${colors.fgCyan}[SOCKET] User identifiziert: ${username}${colors.reset}`);
      }
    } catch {}
  });

  socket.on("chatMessage", async (content) => {
    if (!username) return;
    if (content.length > 150) content = content.slice(0, 150);
    if (userFilters.get(username)) content = filterMessage(content);

    // Prüfe Commands für Admin
    if (content.startsWith("/deleteAllUsers") && isAdmin) {
      const parts = content.split(" ");
      const password = parts[1];
      if (password === process.env.ADMIN_DELETE_PASSWORD) {
        await User.deleteMany({ role: "user" });
        socket.emit("systemMessage", "Alle normalen Nutzer wurden gelöscht.");
        console.log(`${colors.fgYellow}[ADMIN] ${username} hat alle User gelöscht${colors.reset}`);
        return;
      } else {
        socket.emit("systemMessage", "Falsches Admin-Passwort!");
        return;
      }
    }

    try {
      const msg = new Message({ sender: username, content });
      await msg.save();
      const deletedIds = await trimOldMessages(100);
      if (deletedIds.length) io.emit("deletedMessages", deletedIds);

      io.emit("newMessage", {
        _id: msg._id.toString(),
        sender: msg.sender,
        content: msg.content,
        createdAt: msg.createdAt,
        type: "user"
      });
    } catch {
      socket.emit("systemMessage", "Fehler beim Senden der Nachricht");
    }
  });

  socket.on("toggleFilter", (active) => {
    if (!username) return;
    userFilters.set(username, !!active);
  });

  socket.on("disconnect", () => {
    if (DEBUG) console.log(`${colors.fgCyan}[SOCKET] Client getrennt: ${socket.id} (User: ${username || "unbekannt"})${colors.reset}`);
    removeActiveUserBySocket(socket.id);
  });
});

// --- Routes ---
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
    let content = req.body.content;
    const username = req.user.username;
    const isAdmin = req.user.role === "admin";

    if (content.length > 150) content = content.slice(0, 150);
    if (userFilters.get(username)) content = filterMessage(content);

    const msg = new Message({ sender: username, content });
    await msg.save();

    const deletedIds = await trimOldMessages(100);
    if (deletedIds.length) io.emit("deletedMessages", deletedIds);

    io.emit("newMessage", {
      _id: msg._id.toString(),
      sender: msg.sender,
      content: msg.content,
      createdAt: msg.createdAt,
      type: "user"
    });

    res.status(201).json({ message: "Gesendet" });
  } catch {
    res.status(500).json({ error: "Fehler beim Speichern der Nachricht" });
  }
});

// Admin-Route für alle User löschen
app.post("/api/admin/deleteAllUsers", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await User.deleteMany({ role: "user" });
    res.json({ message: "Alle normalen Nutzer gelöscht" });
  } catch {
    res.status(500).json({ error: "Fehler beim Löschen der User" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`${colors.fgGreen}✅ Server läuft auf Port ${PORT}${colors.reset}`));
