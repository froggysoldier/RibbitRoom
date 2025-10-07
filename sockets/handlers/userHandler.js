// sockets/handlers/userHandler.js
import jwt from "jsonwebtoken";
import User from "../../models/User.js";

/**
 * User-Identifikation und Management für Socket.IO (ESM Version)
 * - fügt erfolgreiche sockets zu authenticatedSockets hinzu
 * - entfernt beim disconnect
 * - broadcastActiveUsers() wird aufgerufen
 */
export default function userHandler(socket, ctx) {
  const {
    activeUsers,
    userRoles,
    userFilters,
    broadcastActiveUsers,
    authenticatedSockets, // Set()
    JWT_SECRET,
    io
  } = ctx;

  let username = null;

  const addActive = (uname, socketId, role = "user") => {
    const set = activeUsers.get(uname) || new Set();
    set.add(socketId);
    activeUsers.set(uname, set);
    userRoles.set(uname, role);
    // broadcast the list
    broadcastActiveUsers();
  };

  socket.on("identify", async (payload) => {
    try {
      if (!payload) {
        socket.emit("identifyError", { error: "Keine Nutzerdaten erhalten" });
        return;
      }

      if (payload.token) {
        try {
          const decoded = jwt.verify(payload.token, JWT_SECRET);
          username = decoded.username;
        } catch (err) {
          console.warn("[userHandler] Ungültiger Token:", err.message);
          socket.emit("identifyError", {
            error: err.name === "TokenExpiredError" ? "Token abgelaufen" : "Ungültiger Token"
          });
          return;
        }
      } else if (payload.username) {
        username = payload.username;
      }

      if (!username) {
        socket.emit("identifyError", { error: "Kein Benutzername erkannt" });
        return;
      }

      // DB lookup für Rolle (falls vorhanden)
      const dbUser = await User.findOne({ username });
      const role = dbUser?.role || "user";

      // markiere Socket als aktiv (activeUsers)
      addActive(username, socket.id, role);

      // markiere Socket als authenticated (wichtig für chatMessageHandler)
      try {
        if (authenticatedSockets && typeof authenticatedSockets.add === "function") {
          authenticatedSockets.add(socket.id);
        }
      } catch (err) {
        console.warn("[userHandler] authenticatedSockets not available:", err);
      }

      // sende Bestätigung an Client
      socket.emit("identified", {
        username,
        filterActive: userFilters.get(username) || false,
        role
      });

      console.log(`[Socket] ${username} identifiziert (${role}) -> socket ${socket.id}`);
    } catch (err) {
      console.error("[userHandler] Identify-Fehler:", err);
      socket.emit("identifyError", { error: "Interner Fehler bei Identifizierung" });
    }
  });

  socket.on("disconnect", () => {
    // entferne socket aus activeUsers
    if (username) {
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
        // broadcast new user list
        broadcastActiveUsers();
      }
    }

    // entferne socket aus authenticatedSockets (wichtig!)
    try {
      if (authenticatedSockets && typeof authenticatedSockets.delete === "function") {
        authenticatedSockets.delete(socket.id);
      }
    } catch (err) {
      console.warn("[userHandler] Error removing from authenticatedSockets:", err);
    }

    console.log(`[Socket] disconnected: ${socket.id} (user: ${username || "unknown"})`);
  });
}
