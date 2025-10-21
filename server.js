// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const messageRoutes = require("./routes/messageRoutes");
const initSockets = require("./sockets/initSockets");
const fishRoutes = require("./routes/fishRoutes");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// === EJS aktivieren ===
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use("/api/fish", fishRoutes);
// === Middleware ===
app.use(cors());
app.use(express.json());

// === API Routen ===
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);


// === Statische Dateien ===
app.use(express.static(path.join(__dirname, "public")));

// === Versionierung ===
const renderPage = (page) => (req, res) => {
  const version = Date.now(); // Jede Anfrage bekommt neue CSS-Version
  res.render(page, { version });
};

// === Seiten Routen ===
app.get("/", renderPage("start"));
app.get("/start", renderPage("start"));
app.get("/index", renderPage("index"));
app.get("/kontakt", renderPage("kontakt"));
app.get("/impressum", renderPage("impressum"));

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch(err => console.error("❌ MongoDB Fehler:", err));

// Socket-Events
initSockets(io);

// === Server starten ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`✅ Server läuft auf Port ${PORT}`));







