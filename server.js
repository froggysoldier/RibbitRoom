// server.js
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
const ADMIN_PASS = process.env.ADMIN_PASS || "touchingDowniesadmins";
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
  .catch(err => console.error(`${colors.fgRed}❌ MongoDB Fehler:${err}${colors.reset}`));

app.use(express.static(path.join(__dirname, "public")));

const activeUsers = new Map(); // username -> Set(socketId)
const userFilters = new Map(); // username -> filter aktiv?
const userRoles = new Map(); // username -> role

function broadcastActiveUsers() {
  const users = Array.from(activeUsers.keys())
    .sort()
    .map(username => ({ username, role: userRoles.get(username) || "user" }));
  io.emit("activeUsers", users);
}

function addActiveUser(username, socketId, role = "user") {
  if (!username) return;
  const set = activeUsers.get(username) || new Set();
  const isNew = set.size === 0;
  set.add(socketId);
  activeUsers.set(username, set);
  userRoles.set(username, role);
  if (isNew && DEBUG) console.log(`${colors.fgGreen}[SERVER] User online: ${username}${colors.reset}`);
  broadcastActiveUsers();
}

function removeActiveUserBySocket(socketId) {
  for (const [username, set] of activeUsers.entries()) {
    if (set.has(socketId)) {
      set.delete(socketId);
      if (set.size === 0) {
        activeUsers.delete(username);
        userFilters.delete(username);
        userRoles.delete(username);
        if (DEBUG) console.log(`${colors.fgRed}[SERVER] User offline: ${username}${colors.reset}`);
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
    if (DEBUG) console.log(`${colors.fgYellow}[SERVER] Alte Nachrichten gelöscht: ${idsToDelete.length}${colors.reset}`);
  }
  return idsToDelete;
}

function emitToAdmins(event, payload) {
  for (const [username, sockets] of activeUsers.entries()) {
    const role = userRoles.get(username) || "user";
    if (role === "admin") {
      for (const sid of sockets) io.to(sid).emit(event, payload);
    }
  }
}

io.on("connection", (socket) => {
  if (DEBUG) console.log(`${colors.fgCyan}[SOCKET] connected: ${socket.id}${colors.reset}`);

  let username = null;

  const token = socket.handshake?.auth?.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      username = decoded.username;
      const role = decoded.role || "user";
      addActiveUser(username, socket.id, role);
      socket.emit("identified", { username, filterActive: userFilters.get(username) || false, role });
    } catch {}
  }

  socket.on("identify", async (payload) => {
    try {
      if (payload?.token) {
        const decoded = jwt.verify(payload.token, JWT_SECRET);
        username = decoded.username;
        const dbUser = await User.findOne({ username });
        const role = dbUser?.role || decoded.role || "user";
        addActiveUser(username, socket.id, role);
        socket.emit("identified", { username, filterActive: userFilters.get(username) || false, role });
      } else if (payload?.username) {
        username = payload.username;
        const dbUser = await User.findOne({ username });
        const role = dbUser?.role || "user";
        addActiveUser(username, socket.id, role);
        socket.emit("identified", { username, filterActive: userFilters.get(username) || false, role });
      }
    } catch {}
  });

  socket.on("chatMessage", async (content) => {
    if (!username) return;

    const dbUser = await User.findOne({ username });
    const role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    const trimmed = String(content || "").trim();

    // --- /admin command
    const adminMatch = trimmed.match(/^\/admin\s*(?:[:]\s*)?(.*)$/i);
    if (adminMatch) {
      const provided = (adminMatch[1] || "").trim();
      if (provided && provided === ADMIN_PASS) {
        dbUser.role = "admin";
        await dbUser.save();
        userRoles.set(username, "admin");
        socket.emit("systemMessage", { text: "✔️ Du bist jetzt Admin.", type: "ok" });
        broadcastActiveUsers();
        emitToAdmins("adminNotice", { text: `${username} ist jetzt Admin.` });
      } else {
        socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
      }
      return;
    }

    // --- /reset command
    const resetMatch = trimmed.match(/^\/reset\s*(?:[:]\s*)?(.*)$/i);
    if (resetMatch) {
      const provided = (resetMatch[1] || "").trim();
      if (role !== "admin") {
        socket.emit("systemMessage", { text: "Adminrechte benötigt.", type: "error" });
        return;
      }
      if (provided === ADMIN_PASS) {
        try {
          await Message.deleteMany({});
          await User.deleteMany({});
          activeUsers.clear();
          userFilters.clear();
          userRoles.clear();
          io.emit("systemMessage", { text: "⚠️ RESET durchgeführt: Alle Nutzer und Nachrichten gelöscht.", type: "ok" });
          io.sockets.sockets.forEach(s => s.disconnect());
        } catch (err) {
          console.error("Reset failed", err);
          socket.emit("systemMessage", { text: "Fehler beim Reset.", type: "error" });
        }
      } else {
        socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
      }
      return;
    }

    // --- normal chat message
    let finalContent = content;
    if (finalContent.length > 150) finalContent = finalContent.slice(0, 150);
    if (userFilters.get(username)) finalContent = filterMessage(finalContent);

    try {
      const msg = new Message({ sender: username, content: finalContent });
      await msg.save();
      const deletedIds = await trimOldMessages(100);
      if (deletedIds.length) io.emit("deletedMessages", deletedIds);
      io.emit("newMessage", {
        _id: msg._id.toString(),
        sender: msg.sender,
        content: msg.content,
        createdAt: msg.createdAt,
        senderRole: role,
        type: "user"
      });
    } catch {
      socket.emit("systemMessage", { text: "Fehler beim Senden der Nachricht", type: "error" });
    }
  });

  socket.on("toggleFilter", (active) => {
    if (!username) return;
    userFilters.set(username, !!active);
  });

  socket.on("disconnect", () => {
    removeActiveUserBySocket(socket.id);
  });
});

app.get("/api/messages", async (req, res) => {
  try {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(100);
    res.json(msgs.map(m => ({
      _id: m._id.toString(),
      sender: m.sender,
      content: m.content,
      createdAt: m.createdAt,
      senderRole: "user",
      type: "user"
    })));
  } catch {
    res.status(500).json({ error: "Fehler beim Laden der Nachrichten" });
  }
});

app.post("/api/admin/deleteAllUsers", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await User.deleteMany({ role: "user" });
    for (const uname of userRoles.keys()) {
      const dbu = await User.findOne({ username: uname });
      if (dbu) userRoles.set(uname, dbu.role);
      else userRoles.delete(uname);
    }
    broadcastActiveUsers();
    res.json({ message: "Alle normalen Nutzer gelöscht" });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Löschen der User" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`${colors.fgGreen}✅ Server läuft auf Port ${PORT}${colors.reset}`));
