// sockets/handlers/userHandler.js
import jwt from "jsonwebtoken";
import User from "../../models/User.js";

export default function userHandler(socket, ctx) {
  const {
    activeUsers,
    userRoles,
    userFilters,
    broadcastActiveUsers,
    authenticatedSockets,
    JWT_SECRET,
    io
  } = ctx;

  let username = null;

  const addActive = (uname, socketId, role = "user") => {
    const set = activeUsers.get(uname) || new Set();
    set.add(socketId);
    activeUsers.set(uname, set);
    userRoles.set(uname, role);
    broadcastActiveUsers();
  };

  const removeActive = (uname, socketId) => {
    const set = activeUsers.get(uname);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) {
      activeUsers.delete(uname);
      userRoles.delete(uname);
      userFilters.delete(uname);
    } else {
      activeUsers.set(uname, set);
    }
    broadcastActiveUsers();
  };

  socket.on("identify", async (payload) => {
    try {
      const token = payload?.token || socket.handshake?.auth?.token;
      const maybeUsername = payload?.username;

      if (!token && !maybeUsername) {
        socket.emit("identifyError", { error: "Kein Token oder Benutzername übermittelt" });
        return;
      }

      if (token) {
        if (!JWT_SECRET) {
          console.error("[userHandler] JWT_SECRET nicht gesetzt!");
          socket.emit("identifyError", { error: "Serverfehler: JWT Secret fehlt" });
          return;
        }

        let decoded;
        try {
          decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
          console.warn("[userHandler] Ungültiger Token:", err.message);
          socket.emit("identifyError", { error: err.name === "TokenExpiredError" ? "Token abgelaufen" : "Ungültiger Token" });
          return;
        }
        username = decoded.username || decoded.user || decoded.id;
      } else {
        username = maybeUsername;
      }

      if (!username) {
        socket.emit("identifyError", { error: "Token enthält keinen Benutzernamen" });
        return;
      }

      const dbUser = await User.findOne({ username });
      const role = dbUser?.role || "user";

      addActive(username, socket.id, role);

      socket.data = socket.data || {};
      socket.data.username = username;
      socket.data.role = role;

      authenticatedSockets.add(socket.id);

      socket.emit("identified", { username, role, filterActive: userFilters.get(username) || false });
      console.log(`[userHandler] ${username} identifiziert -> ${socket.id}`);
    } catch (err) {
      console.error("[userHandler] Identify-Fehler:", err);
      socket.emit("identifyError", { error: "Interner Fehler" });
    }
  });

  socket.on("disconnect", () => {
    if (socket.data?.username) removeActive(socket.data.username, socket.id);
    try { authenticatedSockets.delete(socket.id); } catch (e) {}
    console.log(`[userHandler] disconnected: ${socket.id} (user: ${socket.data?.username || "unknown"})`);
  });
}
