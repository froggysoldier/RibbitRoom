// sockets/handlers/userHandler.js
const jwt = require("jsonwebtoken");
const User = require("../../models/User");

module.exports = function(socket, ctx) {
  let { io, activeUsers, userRoles, userFilters, authenticatedSockets, JWT_SECRET, broadcastActiveUsers } = ctx;

  socket.on("identify", async (payload) => {
    try {
      if (payload?.token) {
        const decoded = jwt.verify(payload.token, JWT_SECRET);
        socket.username = decoded.username;
        const dbUser = await User.findOne({ username: socket.username });
        const role = dbUser?.role || decoded.role || "user";

        // add socket to activeUsers map
        const set = activeUsers.get(socket.username) || new Set();
        set.add(socket.id);
        activeUsers.set(socket.username, set);
        userRoles.set(socket.username, role);

        authenticatedSockets.add(socket.id);

        socket.emit("identified", { username: socket.username, filterActive: userFilters.get(socket.username) || false, role });
        broadcastActiveUsers();
      } else if (payload?.username) {
        // anonymous identify by username (no token)
        socket.username = payload.username;
        const dbUser = await User.findOne({ username: socket.username });
        const role = dbUser?.role || "user";

        const set = activeUsers.get(socket.username) || new Set();
        set.add(socket.id);
        activeUsers.set(socket.username, set);
        userRoles.set(socket.username, role);

        // don't add to authenticatedSockets (no token)
        socket.emit("identified", { username: socket.username, filterActive: userFilters.get(socket.username) || false, role });

        broadcastActiveUsers();
      }
    } catch (e) {
      // ignore
    }
  });

  socket.on("requestActiveUsers", () => {
    broadcastActiveUsers();
  });

  socket.on("disconnect", () => {
    if (!socket.username) return;
    // remove this socket from activeUsers
    for (const [uname, sockets] of activeUsers.entries()) {
      if (sockets.has(socket.id)) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          activeUsers.delete(uname);
          userFilters.delete(uname);
          userRoles.delete(uname);
        } else {
          activeUsers.set(uname, sockets);
        }
        break;
      }
    }
    authenticatedSockets.delete(socket.id);

    broadcastActiveUsers();
  });
};
