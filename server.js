// server.js (ersetzt/merge mit deiner vorhandenen server.js)
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const authMiddleware = require("./middleware/auth");
// adminMiddleware bleibt für REST-Admin-Routen, falls vorhanden
const adminMiddleware = require("./middleware/admin");
const Message = require("./models/Message");
const User = require("./models/User");
const filterMessage = require("./utils/filter");

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";
const ADMIN_PASS = process.env.ADMIN_PASS || "touchingDowniesadmins"; // setze in .env
const DEBUG = false;

const colors = {
  reset: "\x1b[0m",
  fgRed: "\x1b[31m",
  fgGreen: "\x1b[32m",
  fgYellow: "\x1b[33m",
  fgCyan: "\x1b[36m"
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);

mongoose.connect(process.env.MONGO_URI, {})
  .then(() => console.log(`${colors.fgGreen}✅ MongoDB verbunden${colors.reset}`))
  .catch(err => console.error(`${colors.fgRed}❌ MongoDB Fehler:${err}${colors.reset}`));

app.use(express.static(path.join(__dirname, "public")));

/*
  activeUsers: Map username -> Set(socketId)
  userRoles: Map username -> role (cached from DB or token)
*/
const activeUsers = new Map();
const userFilters = new Map();
const userRoles = new Map();

function broadcastActiveUsers() {
  // send username + role so frontend can color admins
  const users = Array.from(activeUsers.keys())
    .sort()
    .map(username => ({ username, role: userRoles.get(username) || "user" }));
  io.emit("activeUsers", users);
}

function addActiveUser(username, socketId, role = "user") {
  if (!username) return;
  const set = activeUsers.get(username) || new Set();
  const isNew = set.size === 0;
  set.add(socketId);
  activeUsers.set(username, set);
  // always store role (may be updated later)
  userRoles.set(username, role);
  if (isNew && DEBUG) console.log(`${colors.fgGreen}[SERVER] User online: ${username}${colors.reset}`);
  broadcastActiveUsers();
}

function removeActiveUserBySocket(socketId) {
  for (const [username, set] of activeUsers.entries()) {
    if (set.has(socketId)) {
      set.delete(socketId);
      if (set.size === 0) {
        activeUsers.delete(username);
        userFilters.delete(username);
        userRoles.delete(username);
        if (DEBUG) console.log(`${colors.fgRed}[SERVER] User offline: ${username}${colors.reset}`);
      } else activeUsers.set(username, set);
      broadcastActiveUsers();
      return username;
    }
  }
  return null;
}

async function trimOldMessages(maxMessages = 100) {
  const count = await Message.countDocuments();
  if (count <= maxMessages) return [];
  const excess = count - maxMessages;
  const oldest = await Message.find().sort({ createdAt: 1 }).limit(excess).select("_id");
  const idsToDelete = oldest.map(d => d._id.toString());
  if (idsToDelete.length) {
    await Message.deleteMany({ _id: { $in: idsToDelete } });
    if (DEBUG) console.log(`${colors.fgYellow}[SERVER] Alte Nachrichten gelöscht: ${idsToDelete.length}${colors.reset}`);
  }
  return idsToDelete;
}

/*
 Helper: send event to all sockets of admins
*/
function emitToAdmins(event, payload) {
  for (const [username, sockets] of activeUsers.entries()) {
    const role = userRoles.get(username) || "user";
    if (role === "admin") {
      for (const sid of sockets) {
        io.to(sid).emit(event, payload);
      }
    }
  }
}

/* SOCKET.IO */
io.on("connection", (socket) => {
  if (DEBUG) console.log(`${colors.fgCyan}[SOCKET] connected: ${socket.id}${colors.reset}`);

  let username = null;

  // If client provided token in handshake auth
  const token = socket.handshake?.auth?.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      username = decoded.username;
      const role = decoded.role || "user";
      addActiveUser(username, socket.id, role);
      // send identified with role
      socket.emit("identified", { username, filterActive: userFilters.get(username) || false, role });
    } catch (err) {
      if (DEBUG) console.warn("[SOCKET] token verify failed", err?.message);
    }
  }

  socket.on("identify", async (payload) => {
    try {
      if (payload?.token) {
        const decoded = jwt.verify(payload.token, JWT_SECRET);
        username = decoded.username;
        // use DB role to be safe (in case role was changed)
        const dbUser = await User.findOne({ username });
        const role = dbUser?.role || decoded.role || "user";
        addActiveUser(username, socket.id, role);
        socket.emit("identified", { username, filterActive: userFilters.get(username) || false, role });
      } else if (payload?.username) {
        username = payload.username;
        // read role from DB
        const dbUser = await User.findOne({ username });
        const role = dbUser?.role || "user";
        addActiveUser(username, socket.id, role);
        socket.emit("identified", { username, filterActive: userFilters.get(username) || false, role });
      }
    } catch (err) {
      if (DEBUG) console.warn("[SOCKET] identify failed", err?.message);
    }
  });

  // CHAT MESSAGE handler (all messages via socket)
  socket.on("chatMessage", async (content) => {
    if (!username) return;

    // re-fetch user from DB for authoritative role check
    const dbUser = await User.findOne({ username });
    const role = dbUser?.role || userRoles.get(username) || "user";
    userRoles.set(username, role); // keep cache synced

    // --- Admin-elevation command: /admin : <password>
    // format accepted: /admin : password  OR  /admin password
    const trimmed = String(content || "").trim();
    const adminMatch = trimmed.match(/^\/admin\s*(?:[:]\s*)?(.*)$/i);
    if (adminMatch) {
      const provided = (adminMatch[1] || "").trim();
      // check password
      if (provided && provided === ADMIN_PASS) {
        // update DB role
        dbUser.role = "admin";
        await dbUser.save();
        userRoles.set(username, "admin");
        // notify only the user who requested it
        socket.emit("systemMessage", { text: "✔️ Du bist jetzt Admin.", type: "ok" });
        // update all clients' activeUsers so admins appear red
        broadcastActiveUsers();
        // notify other admins (optional) that a new admin exists
        emitToAdmins("adminNotice", { text: `${username} ist jetzt Admin.` });
      } else {
        socket.emit("systemMessage", { text: "Falsches Admin-Passwort.", type: "error" });
      }
      return; // do not treat as normal chat message (not visible to others)
    }

    // --- Other admin-only commands (example): /deleteAllUsers <pwd>
    const adminCmdMatch = trimmed.match(/^\/([a-zA-Z0-9]+)\s*(.*)$/);
    if (adminCmdMatch) {
      const cmd = adminCmdMatch[1];
      const args = adminCmdMatch[2].trim();

      // if it's an admin command, check role
      const adminOnlyCommands = new Set(["deleteAllUsers", "someOtherAdminCmd"]);
      if (adminOnlyCommands.has(cmd)) {
        if (role !== "admin") {
          // reply only to requester
          socket.emit("systemMessage", { text: "Adminrechte benötigt.", type: "error" });
          return;
        }

        // handle specific admin commands
        if (cmd === "deleteAllUsers") {
          // require password as arg
          if (args === process.env.ADMIN_DELETE_PASS) {
            await User.deleteMany({ role: "user" }); // keep admins
            // inform only admins (and requester)
            emitToAdmins("systemMessage", { text: "Admins: Alle normalen Nutzer wurden gelöscht." });
            socket.emit("systemMessage", { text: "Aktion ausgeführt: Alle normalen Nutzer gelöscht.", type: "ok" });
            // also update caches and broadcast activeUsers
            for (const uname of userRoles.keys()) {
              const dbu = await User.findOne({ username: uname });
              if (dbu) userRoles.set(uname, dbu.role);
            }
            broadcastActiveUsers();
          } else {
            socket.emit("systemMessage", { text: "Falsches Admin-Lösch-Passwort.", type: "error" });
          }
          return;
        }

        // other admin commands handled here...
      }

      // if it was a slash command not admin-only, you can implement here. For now: unknown command -> notify only sender
      if (cmd && !adminOnlyCommands.has(cmd)) {
        socket.emit("systemMessage", { text: `Unbekannter Command: /${cmd}`, type: "info" });
        return;
      }
    }

    // ---- normal message (visible to all) ----
    let finalContent = content;
    if (finalContent.length > 150) finalContent = finalContent.slice(0, 150);
    if (userFilters.get(username)) finalContent = filterMessage(finalContent);

    try {
      const msg = new Message({ sender: username, content: finalContent });
      await msg.save();

      const deletedIds = await trimOldMessages(100);
      if (deletedIds.length) io.emit("deletedMessages", deletedIds);

      // include senderRole so frontend can color admin messages
      io.emit("newMessage", {
        _id: msg._id.toString(),
        sender: msg.sender,
        content: msg.content,
        createdAt: msg.createdAt,
        senderRole: role,
        type: "user"
      });
    } catch (err) {
      console.error("msg save", err);
      socket.emit("systemMessage", { text: "Fehler beim Senden der Nachricht", type: "error" });
    }
  });

  socket.on("toggleFilter", (active) => {
    if (!username) return;
    userFilters.set(username, !!active);
  });

  socket.on("disconnect", () => {
    if (DEBUG) console.log(`${colors.fgCyan}[SOCKET] disconnected: ${socket.id}${colors.reset}`);
    removeActiveUserBySocket(socket.id);
  });
});

/* REST API (unchanged except we include type fields when broadcasting messages) */
app.get("/api/messages", async (req, res) => {
  try {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(100);
    // map to include default senderRole = user (in case older messages)
    const out = msgs.map(m => ({
      _id: m._id.toString(),
      sender: m.sender,
      content: m.content,
      createdAt: m.createdAt,
      senderRole: "user",
      type: "user"
    }));
    res.json(out);
  } catch {
    res.status(500).json({ error: "Fehler beim Laden der Nachrichten" });
  }
});

/* example admin REST route protected by adminMiddleware */
app.post("/api/admin/deleteAllUsers", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await User.deleteMany({ role: "user" });
    // update caches
    for (const uname of userRoles.keys()) {
      const dbu = await User.findOne({ username: uname });
      if (dbu) userRoles.set(uname, dbu.role);
      else userRoles.delete(uname);
    }
    broadcastActiveUsers();
    res.json({ message: "Alle normalen Nutzer gelöscht" });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Löschen der User" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`${colors.fgGreen}✅ Server läuft auf Port ${PORT}${colors.reset}`));

