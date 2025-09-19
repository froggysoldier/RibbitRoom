const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const bodyParser = require("body-parser");
const path = require("path");

const JWT_SECRET = "supersecret";
const ADMIN_PASSWORD = "passwort"; // Admin-Code

// --- Spam-Schutz ---
const messageRate = new Map(); // username → Array mit Zeitstempeln
function checkSpam(username, limit = 5, interval = 10000) {
  const now = Date.now();
  if (!messageRate.has(username)) {
    messageRate.set(username, [now]);
    return false;
  }
  const timestamps = messageRate.get(username).filter(ts => now - ts < interval);
  timestamps.push(now);
  messageRate.set(username, timestamps);
  return timestamps.length > limit;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// --- MongoDB ---
mongoose.connect("mongodb://127.0.0.1:27017/chatapp");

// --- Models ---
const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  email: String,
  role: { type: String, default: "user" }
});

const messageSchema = new mongoose.Schema({
  sender: String,
  senderRole: { type: String, default: "user" },
  content: String,
  createdAt: { type: Date, default: Date.now },
  type: { type: String, default: "user" }
});

const User = mongoose.model("User", userSchema);
const Message = mongoose.model("Message", messageSchema);

// --- In-Memory ---
let activeUsers = new Map(); // socket.id → username
let userRoles = new Map();   // username → role

// --- Auth Middleware ---
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// --- REST API ---
app.post("/api/auth/register", async (req, res) => {
  const { username, password, email, adminPass } = req.body;
  if (!username || !password || !email) return res.status(400).json({ error: "Missing fields" });

  const existing = await User.findOne({ username });
  if (existing) return res.status(400).json({ error: "User exists" });

  const hashed = await bcrypt.hash(password, 10);
  const role = adminPass === ADMIN_PASSWORD ? "admin" : "user";

  const user = new User({ username, password: hashed, email, role });
  await user.save();

  const token = jwt.sign({ username, role }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, role });
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign({ username, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, role: user.role });
});

app.get("/api/messages", authMiddleware, async (req, res) => {
  const msgs = await Message.find().sort({ createdAt: -1 }).limit(50);
  res.json(msgs);
});

// --- Socket.io ---
io.on("connection", (socket) => {
  let username = null;

  socket.on("identify", async ({ token }) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      username = decoded.username;
      activeUsers.set(socket.id, username);
      userRoles.set(username, decoded.role);
      io.emit("activeUsers", Array.from(new Set(activeUsers.values())).map(u => ({ username: u, role: userRoles.get(u) || "user" })));
      socket.emit("identified", { username, role: decoded.role });
    } catch {
      socket.disconnect();
    }
  });

  // --- Chat Nachrichten ---
  socket.on("chatMessage", async (content) => {
    if (!username) return;

    const dbUser = await User.findOne({ username });
    let role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role);

    // --- Spam-Schutz ---
    if (role !== "admin" && checkSpam(username)) {
      socket.emit("systemMessage", { text: "⚠️ Bitte langsamer schreiben – Spam-Schutz aktiv." });
      return;
    }

    // --- Admin-Kommandos ---
    if (role === "admin" && content.startsWith("/")) {
      const parts = content.trim().split(" ");
      const cmd = parts[0];
      const arg = parts[1];

      if (cmd === "/deleteAllUsers" && arg === ADMIN_PASSWORD) {
        await User.deleteMany({});
        await Message.deleteMany({});
        activeUsers.clear();
        userRoles.clear();
        io.emit("forceReload", true);
        return;
      }

      if (cmd === "/reset" && arg === ADMIN_PASSWORD) {
        await User.deleteMany({});
        await Message.deleteMany({});
        activeUsers.clear();
        userRoles.clear();
        io.emit("forceReload", true);
        return;
      }

      if (cmd === "/clear" && arg === ADMIN_PASSWORD) {
        await Message.deleteMany({});
        io.emit("forceReload", false);
        return;
      }
    }

    const msg = new Message({ sender: username, senderRole: role, content });
    await msg.save();
    io.emit("newMessage", msg);
  });

  socket.on("disconnect", () => {
    if (username) {
      activeUsers.delete(socket.id);
      io.emit("activeUsers", Array.from(new Set(activeUsers.values())).map(u => ({ username: u, role: userRoles.get(u) || "user" })));
    }
  });
});

// --- Server Start ---
const PORT = 3000;
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
