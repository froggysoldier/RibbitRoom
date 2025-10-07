// sockets/handlers/userHandler.js
import jwt from "jsonwebtoken";
import User from "../../models/User.js";

/**
 * User-Identifikation und Management für Socket.IO (ESM)
 * - prüft JWT_SECRET
 * - sendet identifyError bei Problemen
 * - fügt socket.id zu authenticatedSockets hinzu
 * - entfernt socket.id beim disconnect
 * - ruft broadcastActiveUsers() nach Änderungen auf
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
    broadcastActiveUsers();
  };

  socket.on("identify", async (payload) => {
    try {
      if (!payload) {
        socket.emit("identifyError", { error: "Keine Nutzerdaten erhalten" });
        return;
      }

      // --- JWT_SECRET Check ---
      if (payload.token) {
        if (!JWT_SECRET) {
          console.error("[userHandler] JWT_SECRET nicht gesetzt!");
          socket.emit("identifyError", { error: "Serverfehler: Authentifizierung nicht konfiguriert" });
          return;
        }

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

      // DB lookup für Rolle (optional)
      const dbUser = await User.findOne({ username });
      const role = dbUser?.role || "user";

      // Active user eintragen
      addActive(username, socket.id, role);

      // AuthenticatedSockets verwalten (wichtig für message broadcasting)
      try {
        if (authenticatedSockets && typeof authenticatedSockets.add === "function") {
          authenticatedSockets.add(socket.id);
          console.log("[userHandler] authenticatedSockets.size =", authenticatedSockets.size);
        }
      } catch (err) {
        console.warn("[userHandler] authenticatedSockets not available:", err);
      }

      // Client bestätigen
      socket.emit("identified", {
        username,
        filterActive: userFilters.get(username) || false,
        role
      });

      console.log(`[userHandler] ${username} identifiziert (${role}) -> socket ${socket.id}`);
    } catch (err) {
      console.error("[userHandler] Identify-Fehler:", err);
      socket.emit("identifyError", { error: "Interner Fehler bei Identifizierung" });
    }
  });

  socket.on("disconnect", () => {
    // Entferne socket aus activeUsers
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
        broadcastActiveUsers();
      }
    }

    // Entferne socket aus authenticatedSockets
    try {
      if (authenticatedSockets && typeof authenticatedSockets.delete === "function") {
        authenticatedSockets.delete(socket.id);
      }
    } catch (err) {
      console.warn("[userHandler] Error removing from authenticatedSockets:", err);
    }

    console.log(`[userHandler] disconnected: ${socket.id} (user: ${username || "unknown"})`);
  });
}
