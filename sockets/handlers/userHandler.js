// sockets/handlers/userHandler.js
const jwt = require("jsonwebtoken");
const User = require("../../models/User");

/**
 * User-Identifikation und Management für Socket.IO
 */
module.exports = function (socket, ctx) {
  const {
    activeUsers,
    userRoles,
    userFilters,
    broadcastActiveUsers,
    JWT_SECRET,
    io
  } = ctx;

  let username = null;

  // === Benutzer hinzufügen ===
  const addActive = (uname, socketId, role = "user") => {
    const set = activeUsers.get(uname) || new Set();
    set.add(socketId);
    activeUsers.set(uname, set);
    userRoles.set(uname, role);
    broadcastActiveUsers();
  };

  // === Benutzer identifizieren ===
  socket.on("identify", async (payload) => {
    try {
      if (!payload) return socket.emit("identifyError", { error: "Keine Nutzerdaten erhalten" });

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

      // Benutzer aus DB laden (Rolle bestimmen)
      const dbUser = await User.findOne({ username });
      const role = dbUser?.role || "user";

      // Aktiv registrieren
      addActive(username, socket.id, role);

      // Client bestätigen
      socket.emit("identified", {
        username,
        filterActive: userFilters.get(username) || false,
        role
      });

      console.log(`[Socket] ${username} verbunden (${role})`);
    } catch (err) {
      console.error("[userHandler] Identify-Fehler:", err);
      socket.emit("identifyError", { error: "Interner Fehler bei Identifizierung" });
    }
  });

  // === Disconnect ===
  socket.on("disconnect", () => {
    if (!username) return;

    const sockets = activeUsers.get(username);
    if (sockets) {
      sockets.delete(socket.id);

      if (sockets.size === 0) {
        activeUsers.delete(username);
        userRoles.delete(username);
        userFilters.delete(username);
        console.log(`[Socket] ${username} vollständig getrennt`);
      } else {
        activeUsers.set(username, sockets);
        console.log(`[Socket] ${username} entfernte Socket ${socket.id}, verbleiben: ${sockets.size}`);
      }

      broadcastActiveUsers();
    }
  });
};
