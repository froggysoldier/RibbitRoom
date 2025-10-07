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

// === Handlers laden (kompatibel mit ESM)
import userHandlerModule from "./sockets/handlers/userHandler.js";
import chatMessageHandlerModule from "./sockets/handlers/chatMessageHandler.js";
const userHandler = userHandlerModule.default || userHandlerModule;
const chatMessageHandler = chatMessageHandlerModule.default || chatMessageHandlerModule;

// === .env Variablen laden ===
dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || "RibbitRoomSecret123!";
const { MONGO_URI, JWT_SECRET, ADMIN_PASS, PORT = 3000 } = process.env;

// === Express & Server Setup ===
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// === Middleware ===
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === MongoDB ===
if (!MONGO_URI) {
  console.error("❌ Keine MONGO_URI in .env gesetzt!");
  process.exit(1);
}
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch((err) => {
    console.error("❌ MongoDB Fehler:", err);
    process.exit(1);
  });

// === Static Files ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// === API Routes ===
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);

// === Socket-Storage ===
const activeUsers = new Map(); // username -> Set(socketIds)
const userRoles = new Map(); // username -> role
const userFilters = new Map(); // username -> bool
const authenticatedSockets = new Set(); // socket.id
const lastMessageTime = new Map(); // username -> timestamp

// === Helper-Funktionen ===
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
    if (role === "admin" && socketsSet) {
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

// === Socket.IO Verbindung ===
io.on("connection", (socket) => {
  console.log("🔌 Neue Socket-Verbindung:", socket.id);

  // ⚙️ Context für Handler vorbereiten
  const ctx = {
    io,
    activeUsers,
    userRoles,
    userFilters,
    authenticatedSockets,
    broadcastActiveUsers,
    emitToAdmins,
    trimOldMessages,
    lastMessageTime,
    JWT_SECRET: JWT_SECRET || "fallback_secret", // <- stellt sicher, dass es immer gesetzt ist
    ADMIN_PASS: ADMIN_PASS || "admin123",        // <- fallback falls vergessen
  };

  // === Handler initialisieren ===
  try {
    userHandler(socket, ctx);
    chatMessageHandler(socket, ctx);
  } catch (err) {
    console.error("❌ Fehler beim Initialisieren der Socket-Handler:", err);
  }

  // === Disconnect-Handling ===
  socket.on("disconnect", () => {
    for (const [uname, socketsSet] of activeUsers.entries()) {
      if (socketsSet.has(socket.id)) {
        socketsSet.delete(socket.id);
        if (socketsSet.size === 0) {
          activeUsers.delete(uname);
          userRoles.delete(uname);
          userFilters.delete(uname);
        }
        break;
      }
    }
    authenticatedSockets.delete(socket.id);
    broadcastActiveUsers();
    console.log(`❌ Socket getrennt: ${socket.id}`);
  });
});

// === Server Start ===
server.listen(PORT, () => {
  console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
  if (!JWT_SECRET) console.warn("⚠️ Warnung: JWT_SECRET nicht gesetzt! Verwende Fallback.");
  if (!ADMIN_PASS) console.warn("⚠️ Warnung: ADMIN_PASS nicht gesetzt! Verwende Fallback.");
});

