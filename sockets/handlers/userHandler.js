// sockets/handlers/userHandler.js
import jwt from "jsonwebtoken";
import User from "../../models/User.js";

/**
 * Benutzer-Identifizierung & Verwaltung aktiver Sockets.
 * - prüft JWTs
 * - verwaltet activeUsers + Rollen
 * - synchronisiert aktive Nutzerliste
 * - entfernt User beim Disconnect
 */
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

  // === Hilfsfunktionen ===
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

  // === Benutzer identifizieren ===
  socket.on("identify", async (payload) => {
    try {
      const token = payload?.token || socket.handshake?.auth?.token;
      const maybeUsername = payload?.username;

      if (!token && !maybeUsername) {
        socket.emit("identifyError", { error: "Kein Token oder Benutzername übermittelt" });
        return;
      }

      // --- Prüfe JWT ---
      if (token) {
        if (!JWT_SECRET) {
          console.error("[userHandler] JWT_SECRET nicht gesetzt!");
          socket.emit("identifyError", { error: "Serverfehler: JWT Secret fehlt" });
          return;
        }

        try {
          const decoded = jwt.verify(token, JWT_SECRET);
          username = decoded.username || decoded.user || decoded.id || decoded.name;
        } catch (err) {
          console.warn("[userHandler] Ungültiger Token:", err.message);
          socket.emit("identifyError", {
            error: err.name === "TokenExpiredError" ? "Deine Sitzung ist abgelaufen." : "Ungültiger Login-Token."
          });
          return;
        }
      } else {
        // Fallback (nicht empfohlen)
        username = maybeUsername;
      }

      if (!username) {
        socket.emit("identifyError", { error: "Token enthält keinen Benutzernamen" });
        return;
      }

      // --- Benutzerrolle laden ---
      const dbUser = await User.findOne({ username });
      const role = dbUser?.role || "user";

      // --- Socket speichern ---
      addActive(username, socket.id, role);

      socket.data.username = username;
      socket.data.role = role;

      // --- Authentifizierten Socket merken ---
      authenticatedSockets.add(socket.id);

      // --- Rückmeldung an Client ---
      socket.emit("identified", {
        username,
        role,
        filterActive: userFilters.get(username) || false
      });

      console.log(`[userHandler] ${username} identifiziert (Rolle: ${role}) – Socket ${socket.id}`);
    } catch (err) {
      console.error("[userHandler] Identify-Fehler:", err);
      socket.emit("identifyError", { error: "Fehler bei Identifizierung" });
    }
  });

  // === Disconnect ===
  socket.on("disconnect", () => {
    if (socket.data?.username) {
      removeActive(socket.data.username, socket.id);
    }
    authenticatedSockets.delete(socket.id);
    console.log(`[userHandler] disconnected: ${socket.id} (user: ${socket.data?.username || "unknown"})`);
  });
}
