const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const messageRoutes = require("./routes/messageRoutes");
const initSockets = require("./sockets/initSockets");
const trimOldMessages = require("./utils/trimOldMessages");

// ---- Dein zentrales ctx ----
const ctx = {
  activeUsers: new Map(),
  userRoles: new Map(),
  userFilters: new Map(),
  authenticatedSockets: new Set(),
  lastMessageTime: new Map(),
  lastSpamWarnTime: new Map(),
  trimOldMessages,
  emitToAdmins: null, // setzen wir nach io-Erstellung
  JWT_SECRET: process.env.JWT_SECRET,
  ADMIN_PASS: process.env.ADMIN_PASS,
  io: null // setzen wir nach io-Erstellung
};

// ---- Express + Socket.io Setup ----
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

ctx.io = io;
ctx.emitToAdmins = (event, payload) => {
  for (const sid of ctx.authenticatedSockets) {
    io.to(sid).emit(event, payload);
  }
};

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use(express.static(path.join(__dirname, "public")));

// ---- DB verbinden ----
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch(err => console.error("❌ MongoDB Fehler:", err));

// ---- Sockets starten ----
initSockets(io, ctx);

// ---- Server starten ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Server läuft auf Port ${PORT}`)
);
