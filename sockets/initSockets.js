// sockets/initSockets.js
const jwt = require("jsonwebtoken");
const Message = require("../models/Message");
const User = require("../models/User");
const filterMessage = require("../utils/filter");

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";
const ADMIN_PASS = process.env.ADMIN_PASS || "28102024";

module.exports = function(io) {
  const activeUsers = new Map();
  const userFilters = new Map();
  const userRoles = new Map();
  const lastMessageTime = new Map();

  // Set mit allen authentifizierten Socket-IDs (werden die activeUsers sehen dürfen)
  const authenticatedSockets = new Set();

  const broadcastActiveUsers = () => {
    const users = Array.from(activeUsers.keys())
      .sort()
      .map(username => ({ username, role: userRoles.get(username) || "user" }));

    // nur an authentifizierte sockets senden
    for (const sid of authenticatedSockets) {
      io.to(sid).emit("activeUsers", users);
    }
  };

  const addActiveUser = (username, socketId, role = "user") => {
    if (!username) return;
    const set = activeUsers.get(username) || new Set();
    set.add(socketId);
    activeUsers.set(username, set);
    userRoles.set(username, role);
    broadcastActiveUsers();
  };

  const removeActiveUserBySocket = (socketId) => {
    authenticatedSockets.delete(socketId);
    for (const [username, set] of activeUsers.entries()) {
      if (set.has(socketId)) {
        set.delete(socketId);
        if (set.size === 0) {
          activeUsers.delete(username);
          userFilters.delete(username);
          userRoles.delete(username);
        } else activeUsers.set(username, set);
        broadcastActiveUsers();
        return username;
      }
    }
    return null;
  };

  const trimOldMessages = async (maxMessages = 100) => {
    const count = await Message.countDocuments();
    if (count <= maxMessages) return [];
    const excess = count - maxMessages;
    const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess).select("_id");
    const idsToDelete = oldest.map(d => d._id.toString());
    if (idsToDelete.length) await Message.deleteMany({ _id: { $in: idsToDelete } });
    return idsToDelete;
  };

  const emitToAdmins = (event, payload) => {
    for (const [username, sockets] of activeUsers.entries()) {
      const role = userRoles.get(username) || "user";
      if (role === "admin") {
        for (const sid of sockets) io.to(sid).emit(event, payload);
      }
    }
  };

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
        // markiere socket als authentifiziert
        authenticatedSockets.add(socket.id);
        addActiveUser(username, socket.id, role);
        socket.emit("identified", {
          username,
          filterActive: userFilters.get(username) || false,
          role
        });
      } catch {}
    }

    // wenn ein Client explizit nach aktiven usern fragt -> nur an ihn senden
    socket.on("requestActiveUsers", () => {
      const users = Array.from(activeUsers.keys())
        .sort()
        .map(username => ({ username, role: userRoles.get(username) || "user" }));
      // send only to this socket
      socket.emit("activeUsers", users);
    });

    // Alle Socket-Event-Handler injizieren (inkl. io und authenticatedSockets)
    require("./handlers/chatMessageHandler")(socket, {
      username,
      activeUsers,
      userRoles,
      userFilters,
      lastMessageTime,
      trimOldMessages,
      emitToAdmins,
      authenticatedSockets,
      JWT_SECRET,
      ADMIN_PASS,
      io
    });
    require("./handlers/userHandler")(socket, {
      username,
      activeUsers,
      userRoles,
      userFilters,
      broadcastActiveUsers,
      authenticatedSockets,
      JWT_SECRET
    });
  });
};
