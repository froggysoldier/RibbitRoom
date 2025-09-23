// sockets/handlers/userHandler.js
const jwt = require("jsonwebtoken");
const User = require("../../models/User");

module.exports = function(socket, ctx) {
  let {
    username,
    activeUsers,
    userRoles,
    userFilters,
    broadcastActiveUsers,
    authenticatedSockets,
    JWT_SECRET,
    io
  } = ctx;

  const addActive = (uname, socketId, role = "user") => {
    if (!uname) return;
    const set = activeUsers.get(uname) || new Set();
    set.add(socketId);
    activeUsers.set(uname, set);
    userRoles.set(uname, role);
    authenticatedSockets.add(socketId);
    broadcastActiveUsers();
  };

  socket.on("identify", async (payload) => {
    try {
      if (!payload) return;

      if (payload.token) {
        const decoded = jwt.verify(payload.token, JWT_SECRET);
        username = decoded.username;
      } else if (payload.username) {
        username = payload.username;
      }

      if (!username) return;

      const dbUser = await User.findOne({ username });
      const role = dbUser?.role || "user";

      addActive(username, socket.id, role);

      socket.emit("identified", {
        username,
        filterActive: userFilters.get(username) || false,
        role
      });
    } catch (err) {
      console.error("Identify-Fehler:", err);
    }
  });

  socket.on("disconnect", () => {
    if (!username) return;

    authenticatedSockets.delete(socket.id);

    const sockets = activeUsers.get(username);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        activeUsers.delete(username);
        userRoles.delete(username);
        userFilters.delete(username);
      } else {
        activeUsers.set(username, sockets);
      }
      broadcastActiveUsers();
    }
  });
};


