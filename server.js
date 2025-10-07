// server.js
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

// 🧩 Handlers
import userHandler from "./sockets/handlers/userHandler.js";
import chatMessageHandler from "./sockets/handlers/chatMessageHandler.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

// === Middleware ===
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === MongoDB verbinden ===
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch((err) => console.error("❌ MongoDB Fehler:", err));

// === Static Files ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// === API Routes ===
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);

// === Socket Kontext ===
const activeUsers = new Map();
const userRoles = new Map();
const userFilters = new Map();
const authenticatedSockets = new Set();
const lastMessageTime = new Map();

function broadcastActiveUsers() {
  const users = Array.from(activeUsers.keys()).map((username) => ({
    username,
    role: userRoles.get(username) || "user",
  }));
  io.emit("activeUsers", users);
}

function emitToAdmins(event, data) {
  for (const [uname, socketsSet] of activeUsers.entries()) {
    const role = userRoles.get(uname);
    if (role === "admin") {
      for (const sid of socketsSet) io.to(sid).emit(event, data);
    }
  }
}

async function trimOldMessages(maxMessages = 100) {
  const Message = (await import("./models/Message.js")).default;
  const count = await Message.countDocuments();
  if (count <= maxMessages) return [];
  const excess = count - maxMessages;
  const oldMsgs = await Message.find().sort({ createdAt: 1 }).limit(excess);
  const ids = oldMsgs.map((m) => m._id);
  await Message.deleteMany({ _id: { $in: ids } });
  return ids;
}

// === Socket.IO ===
io.on("connection", (socket) => {
  console.log("🔌 Neue Socket-Verbindung:", socket.id);

  const ctx = {
    activeUsers,
    userRoles,
    userFilters,
    authenticatedSockets,
    broadcastActiveUsers,
    emitToAdmins,
    trimOldMessages,
    lastMessageTime,
    JWT_SECRET: process.env.JWT_SECRET,
    ADMIN_PASS: process.env.ADMIN_PASS,
    io,
  };

  // 🧩 User + Chat Handler initialisieren
  userHandler(socket, ctx);
  chatMessageHandler(socket, ctx);

  socket.on("disconnect", () => {
    console.log("❌ Socket getrennt:", socket.id);
  });
});

// === Start ===
server.listen(PORT, () => {
  console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
});
