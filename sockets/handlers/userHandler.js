// sockets/handlers/userHandler.js
const jwt = require("jsonwebtoken");
const User = require("../../models/User");

module.exports = function(socket, ctx) {
  let { username, activeUsers, userRoles, userFilters, broadcastActiveUsers, JWT_SECRET, io } = ctx;

  socket.on("identify", async (payload) => {
    try {
      if (payload?.token) {
        const decoded = jwt.verify(payload.token, JWT_SECRET);
        username = decoded.username;
        const dbUser = await User.findOne({ username });
        const role = dbUser?.role || decoded.role || "user";

        const set = activeUsers.get(username) || new Set();
        set.add(socket.id);
        activeUsers.set(username, set);
        userRoles.set(username, role);

        socket.emit("identified", { username, filterActive: userFilters.get(username) || false, role });
        broadcastActiveUsers();
      } else if (payload?.username) {
        username = payload.username;
        const dbUser = await User.findOne({ username });
        const role = dbUser?.role || "user";

        const set = activeUsers.get(username) || new Set();
        set.add(socket.id);
        activeUsers.set(username, set);
        userRoles.set(username, role);

        socket.emit("identified", { username, filterActive: userFilters.get(username) || false, role });
        broadcastActiveUsers();
      }
    } catch (err) {
      console.error("Identify-Fehler:", err);
    }
  });

  socket.on("disconnect", () => {
    if (!username) return;

    const sockets = activeUsers.get(username);
    if (sockets && sockets.has(socket.id)) {
      sockets.delete(socket.id);
      if (!sockets.size) {
        activeUsers.delete(username);
        userRoles.delete(username);
        userFilters.delete(username);
      }
      broadcastActiveUsers();
    }
  });
};
