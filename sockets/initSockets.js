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


  const authenticatedSockets = new Set();

  // --------------------------------------------
  // Aktive Nutzerliste an eingeloggte Nutzer senden
  // --------------------------------------------
  const broadcastActiveUsers = () => {
    const users = Array.from(activeUsers.keys())
      .sort()
      .map(username => ({
        username,
        role: userRoles.get(username) || "user"
      }));


    for (const sid of authenticatedSockets) {
      io.to(sid).emit("activeUsers", users);
    }
  };

  // --------------------------------------------
  // Nutzer hinzufügen
  // --------------------------------------------
  const addActiveUser = (username, socketId, role = "user") => {
    if (!username) return;
    const set = activeUsers.get(username) || new Set();
    set.add(socketId);
    activeUsers.set(username, set);
    userRoles.set(username, role);
    broadcastActiveUsers();
  };

  // --------------------------------------------
  // Nutzer entfernen (z. B. beim Disconnect)
  // --------------------------------------------
  const removeActiveUserBySocket = (socketId) => {
    authenticatedSockets.delete(socketId);
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
        break;
      }
    }
    broadcastActiveUsers();
  };

  // --------------------------------------------
  // Alte Nachrichten kürzen
  // --------------------------------------------
  const trimOldMessages = async (maxMessages = 100) => {
    const count = await Message.countDocuments();
    if (count <= maxMessages) return [];
    const excess = count - maxMessages;
    const oldest = await Message.find()
      .sort({ createdAt: 1 })
      .limit(excess)
      .select("_id");
    const idsToDelete = oldest.map(d => d._id.toString());
    if (idsToDelete.length)
      await Message.deleteMany({ _id: { $in: idsToDelete } });
    return idsToDelete;
  };

  // --------------------------------------------
  // Nur an Admins senden
  // --------------------------------------------
  const emitToAdmins = (event, payload) => {
    for (const [username, sockets] of activeUsers.entries()) {
      const role = userRoles.get(username) || "user";
      if (role === "admin") {
        for (const sid of sockets) io.to(sid).emit(event, payload);
      }
    }
  };

  // --------------------------------------------
  // Haupt-Connection
  // --------------------------------------------
  io.on("connection", async (socket) => {
    let username = null;
    const token = socket.handshake?.auth?.token;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        username = decoded.username;
        const dbUser = await User.findOne({ username });
        const role = dbUser?.role || "user";

        authenticatedSockets.add(socket.id);
        addActiveUser(username, socket.id, role);

        socket.emit("identified", {
          username,
          filterActive: userFilters.get(username) || false,
          role
        });

        broadcastActiveUsers();

      } catch (err) {
        console.warn("JWT ungültig oder abgelaufen:", err.message);
      }
    }

    // -------------------------------
    // Anfrage nach aktiven Nutzern
    // -------------------------------
    socket.on("requestActiveUsers", () => {
      const users = Array.from(activeUsers.keys())
        .sort()
        .map(username => ({
          username,
          role: userRoles.get(username) || "user"
        }));
      socket.emit("activeUsers", users);
    });

    // -------------------------------
    // Chat & User Handler laden
    // -------------------------------
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

    // -------------------------------
    // Disconnect-Handler
    // -------------------------------
    socket.on("disconnect", () => {
      removeActiveUserBySocket(socket.id);
    });
  });
};
