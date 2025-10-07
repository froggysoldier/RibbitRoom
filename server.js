import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import path from "path";
import { fileURLToPath } from "url";
import sendMail from "./utils/sendMail.js";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import userHandler from "./sockets/handlers/userHandler.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// === Middleware ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === CORS (für Render und lokale Tests) ===
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  credentials: true
}));

// === MongoDB verbinden ===
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB verbunden"))
  .catch(err => console.error("MongoDB Fehler:", err));

// === Static public Ordner ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// === API Routes ===
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);

// === HTTP + Socket.IO Server ===
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // erlaubt Verbindung von Render + lokal
    methods: ["GET", "POST"],
    credentials: true
  }
});

// === Socket-Kontext ===
const activeUsers = new Map();
const userRoles = new Map();
const userFilters = new Map();

function broadcastActiveUsers() {
  const users = Array.from(activeUsers.keys()).map(username => ({
    username,
    role: userRoles.get(username) || "user"
  }));
  io.emit("activeUsers", users);
}

// === Socket.IO Verbindung ===
io.on("connection", (socket) => {
  console.log("🔌 Neue Verbindung:", socket.id);

  userHandler(socket, {
    activeUsers,
    userRoles,
    userFilters,
    broadcastActiveUsers,
    JWT_SECRET: process.env.JWT_SECRET,
    io
  });

  socket.on("disconnect", () => {
    console.log("❌ Verbindung geschlossen:", socket.id);
  });
});

// === Server starten ===
server.listen(PORT, () => {
  console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
});
