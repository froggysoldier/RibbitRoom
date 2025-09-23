// server.js
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
const trimOldMessages = require("./utils/trimOldMessages"); // optional, falls du diese util hast

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";
const ADMIN_PASS = process.env.ADMIN_PASS || "28102024";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// zentrales ctx-Objekt
const ctx = {
  activeUsers: new Map(),
  userRoles: new Map(),
  userFilters: new Map(),
  authenticatedSockets: new Set(),
  lastMessageTime: new Map(),
  lastSpamWarnTime: new Map(),
  trimOldMessages: trimOldMessages || (async (m = 100) => { /* fallback falls util fehlt */ return []; }),
  JWT_SECRET,
  ADMIN_PASS,
  io,
  emitToAdmins: (event, payload) => {
    for (const [uname, sockets] of ctx.activeUsers.entries()) {
      const role = ctx.userRoles.get(uname) || "user";
      if (role === "admin") {
        for (const sid of sockets) io.to(sid).emit(event, payload);
      }
    }
  },
  broadcastActiveUsers: () => {
    const users = Array.from(ctx.activeUsers.keys())
      .sort()
      .map(username => ({ username, role: ctx.userRoles.get(username) || "user" }));
    for (const sid of ctx.authenticatedSockets) {
      io.to(sid).emit("activeUsers", users);
    }
  }
};

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use(express.static(path.join(__dirname, "public")));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch(err => console.error("❌ MongoDB Fehler:", err));

// sockets initialisieren und ctx übergeben
initSockets(io, ctx);

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`✅ Server läuft auf Port ${PORT}`));
