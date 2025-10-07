// sockets/handlers/userHandler.js
import jwt from "jsonwebtoken";
import User from "../../models/User.js";

/**
 * userHandler: identifiziert Benutzer via JWT (oder username payload),
 * setzt socket.data.username und socket.data.role,
 * fügt socket.id zu authenticatedSockets hinzu und entfernt beim disconnect,
 * broadcastet active users.
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
      // token kann über payload.token oder handshake.auth.token gesendet werden
      const token = payload?.token || socket.handshake?.auth?.token;
      const maybeUsername = payload?.username;

      if (!token && !maybeUsername) {
        socket.emit("identifyError", { error: "Kein Token oder Benutzername übermittelt" });
        return;
      }

      // Wenn Token vorhanden → JWT prüfen
      if (token) {
        if (!JWT_SECRET) {
          console.error("[userHandler] JWT_SECRET nicht gesetzt!");
          socket.emit("identifyError", { error: "Serverfehler: Authentifizierung nicht konfiguriert" });
          return;
        }

        let decoded;
        try {
          decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
          console.warn("[userHandler] Ungültiger Token:", err.message);
          socket.emit("identifyError", {
            error: err.name === "TokenExpiredError" ? "Token abgelaufen" : "Ungültiger Token"
          });
          return;
        }
        username = decoded.username || decoded.user || decoded.id && decoded.username;
      } else {
        // Fallback: username direkt über payload.username (nicht empfohlen für Produktion)
        username = maybeUsername;
      }

      if (!username) {
        socket.emit("identifyError", { error: "Token enthält keinen Benutzernamen" });
        return;
      }

      // DB lookup für Rolle
      const dbUser = await User.findOne({ username });
      const role = dbUser?.role || "user";

      // Active user eintragen
      addActive(username, socket.id, role);

      // socket.data setzen (wird vom chatHandler genutzt)
      try {
        socket.data = socket.data || {};
        socket.data.username = username;
        socket.data.role = role;
      } catch (e) {
        // falls socket.data nicht verfügbar (sehr unwahrscheinlich), ignore
      }

      // Authenticated socket merken (wichtig für broadcasting Granularität)
      try {
        if (authenticatedSockets && typeof authenticatedSockets.add === "function") {
          authenticatedSockets.add(socket.id);
          console.log("[userHandler] authenticatedSockets.size =", authenticatedSockets.size);
        }
      } catch (err) {
        console.warn("[userHandler] authenticatedSockets not available:", err);
      }

      // Bestätigung an Client
      socket.emit("identified", {
        username,
        role,
        filterActive: userFilters.get(username) || false
      });

      console.log(`[userHandler] ${username} identifiziert -> socket ${socket.id}`);
    } catch (err) {
      console.error("[userHandler] Identify-Fehler:", err);
      socket.emit("identifyError", { error: "Interner Fehler bei Identifizierung" });
    }
  });

  socket.on("disconnect", () => {
    // Entferne socket aus activeUsers
    if (socket.data?.username) {
      const uname = socket.data.username;
      const set = activeUsers.get(uname);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          activeUsers.delete(uname);
          userRoles.delete(uname);
          userFilters.delete(uname);
        } else {
          activeUsers.set(uname, set);
        }
        broadcastActiveUsers();
      }
    }

    // Entferne aus authenticatedSockets
    try {
      authenticatedSockets?.delete(socket.id);
    } catch (e) {}

    console.log(`[userHandler] disconnected: ${socket.id} (user: ${socket.data?.username || "unknown"})`);
  });
}
