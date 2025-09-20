// sockets/initSockets.js
const jwt = require("jsonwebtoken");
const Message = require("../models/Message");
const User = require("../models/User");
const filterMessage = require("../utils/filter");

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";
const ADMIN_PASS = process.env.ADMIN_PASS || "28102024";

module.exports = function(io) {
  const activeUsers = new Map();        // username -> Set(socketId)
  const userFilters = new Map();        // username -> bool
  const userRoles = new Map();          // username -> role
  const lastMessageTime = new Map();    // username -> timestamp
  const authenticatedSockets = new Set(); // socket.id for authenticated clients

  const broadcastActiveUsers = () => {
    const users = Array.from(activeUsers.keys())
      .sort()
      .map(username => ({ username, role: userRoles.get(username) || "user" }));
    io.emit("activeUsers", users);
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
    for (const [username, set] of activeUsers.entries()) {
      if (set.has(socketId)) {
        set.delete(socketId);
        if (set.size === 0) {
          activeUsers.delete(username);
          userFilters.delete(username);
          userRoles.delete(username);
        } else {
          activeUsers.set(username, set);
        }
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
    // per-socket properties
    socket.username = null;

    // check handshake token
    const token = socket.handshake?.auth?.token;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.username = decoded.username;
        const dbUser = await User.findOne({ username: socket.username });
        const role = dbUser?.role || decoded.role || "user";

        // add to active lists
        addActiveUser(socket.username, socket.id, role);
        authenticatedSockets.add(socket.id);

        // tell the client who they are
        socket.emit("identified", { username: socket.username, filterActive: userFilters.get(socket.username) || false, role });
      } catch (e) {
        // ignore invalid token
      }
    }

    // pass context to handlers
    const ctx = {
      io,
      activeUsers,
      userFilters,
      userRoles,
      lastMessageTime,
      trimOldMessages,
      emitToAdmins,
      authenticatedSockets,
      JWT_SECRET,
      ADMIN_PASS
    };

    // handlers
    require("./handlers/chatMessageHandler")(socket, ctx);
    require("./handlers/userHandler")(socket, ctx);
  });
};
