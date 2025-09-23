const jwt = require("jsonwebtoken");
const Message = require("../models/Message");
const User = require("../models/User");
const filterMessage = require("../utils/filter");

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";
const ADMIN_PASS = process.env.ADMIN_PASS || "28102024";

module.exports = function(io) {
  // --- zentrale Stores / ctx ---
  const ctx = {
    activeUsers: new Map(),
    userFilters: new Map(),
    userRoles: new Map(),
    lastMessageTime: new Map(),
    lastSpamWarnTime: new Map(),
    authenticatedSockets: new Set(),
    JWT_SECRET,
    ADMIN_PASS,
    io,
    trimOldMessages: async (maxMessages = 100) => {
      const count = await Message.countDocuments();
      if (count <= maxMessages) return [];
      const excess = count - maxMessages;
      const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess).select("_id");
      const idsToDelete = oldest.map(d => d._id.toString());
      if (idsToDelete.length) await Message.deleteMany({ _id: { $in: idsToDelete } });
      return idsToDelete;
    },
    emitToAdmins: (event, payload) => {
      for (const [username, sockets] of ctx.activeUsers.entries()) {
        const role = ctx.userRoles.get(username) || "user";
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

  const addActiveUser = (username, socketId, role = "user") => {
    if (!username) return;
    const set = ctx.activeUsers.get(username) || new Set();
    set.add(socketId);
    ctx.activeUsers.set(username, set);
    ctx.userRoles.set(username, role);
    ctx.broadcastActiveUsers();
  };

  const removeActiveUserBySocket = (socketId) => {
    ctx.authenticatedSockets.delete(socketId);
    for (const [username, set] of ctx.activeUsers.entries()) {
      if (set.has(socketId)) {
        set.delete(socketId);
        if (set.size === 0) {
          ctx.activeUsers.delete(username);
          ctx.userFilters.delete(username);
          ctx.userRoles.delete(username);
        } else ctx.activeUsers.set(username, set);
        ctx.broadcastActiveUsers();
        return username;
      }
    }
    return null;
  };

  // --- Socket-Verbindung ---
  io.on("connection", async (socket) => {
    let username = null;
    const token = socket.handshake?.auth?.token;

    // Token-Login (Handshake)
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        username = decoded.username;
        const dbUser = await User.findOne({ username });
        const role = dbUser?.role || "user";

        ctx.authenticatedSockets.add(socket.id);
        addActiveUser(username, socket.id, role);

        socket.emit("identified", {
          username,
          filterActive: ctx.userFilters.get(username) || false,
          role
        });
      } catch {}
    }

    // Client fragt nach aktiven Nutzern
    socket.on("requestActiveUsers", () => {
      const users = Array.from(ctx.activeUsers.keys())
        .sort()
        .map(username => ({ username, role: ctx.userRoles.get(username) || "user" }));
      socket.emit("activeUsers", users);
    });

    // --- Handlers laden und ctx übergeben ---
    require("./handlers/chatMessageHandler")(socket, ctx);
    require("./handlers/userHandler")(socket, ctx);
  });
};
