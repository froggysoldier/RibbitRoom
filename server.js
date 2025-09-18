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
const User = require("./models/User"); // <-- NEU
const filterMessage = require("./utils/filter");

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

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

const activeUsers = new Map();
const userFilters = new Map(); // username -> filter aktiv?

function broadcastActiveUsers() {
  const users = Array.from(activeUsers.keys()).sort();
  io.emit("activeUsers", users);
}

function addActiveUser(username, socketId) {
  if (!username) return;
  const set = activeUsers.get(username) || new Set();
  set.add(socketId);
  activeUsers.set(username, set);
  broadcastActiveUsers();
}

function removeActiveUserBySocket(socketId) {
  for (const [username, set] of activeUsers.entries()) {
    if (set.has(socketId)) {
      set.delete(socketId);
      if (set.size === 0) {
        activeUsers.delete(username);
        userFilters.delete(username);
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
  const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess).select('_id');
  const idsToDelete = oldest.map(d => d._id.toString());
  if (idsToDelete.length) {
    const { deletedCount } = await Message.deleteMany({ _id: { $in: idsToDelete } });
    console.log(`🗑️ ${deletedCount} alte Nachrichten gelöscht`);
  }
  return idsToDelete;
}

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
        addActiveUser(username, socket.id);
        socket.emit("identified", { username, filterActive: userFilters.get(username) || false });
      } else if (payload?.username) {
        username = payload.username;
        addActiveUser(username, socket.id);
        socket.emit("identified", { username, filterActive: userFilters.get(username) || false });
      }
    } catch {}
  });

  // --- NEU: Chatnachrichten inkl. /admin:passwort ---
  socket.on("chatMessage", async (content) => {
    if (!username) return;

    // Admin-Befehl erkennen
    if (content.startsWith("/admin:")) {
      const secret = content.split(":")[1]?.trim();
      if (secret === process.env.ADMIN_SECRET) {
        try {
          const user = await User.findOne({ username });
          if (user) {
            user.role = "admin";
            await user.save();
            socket.emit("info", "✅ Du bist jetzt Admin!");
            console.log(`${username} wurde Admin`);
          }
        } catch (err) {
          console.error("Admin-Rolle vergeben Fehler:", err);
          socket.emit("info", "❌ Fehler beim Vergeben der Admin-Rolle");
        }
      } else {
        socket.emit("info", "❌ Falsches Admin-Passwort");
      }
      return; // Nachricht wird nicht normal gesendet
    }

    // Normale Nachricht
    let filteredContent = content;
    if (userFilters.get(username)) filteredContent = filterMessage(content);

    try {
      const msg = new Message({ sender: username, content: filteredContent });
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
    res.json(msgs);
  } catch {
    res.status(500).json({ error: "Fehler beim Laden der Nachrichten" });
  }
});

app.post("/api/messages", authMiddleware, async (req, res) => {
  try {
    let content = req.body.content;
    const username = req.user.username;

    if (userFilters.get(username)) {
      content = filterMessage(content);
    }

    const msg = new Message({ sender: username, content });
    await msg.save();

    const deletedIds = await trimOldMessages(100);
    if (deletedIds.length) io.emit("deletedMessages", deletedIds);

    const payload = { _id: msg._id.toString(), sender: msg.sender, content: msg.content, createdAt: msg.createdAt };
    io.emit("newMessage", payload);

    res.status(201).json(payload);
  } catch {
    res.status(500).json({ error: "Fehler beim Speichern der Nachricht" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`✅ Server läuft auf Port ${PORT}`));
