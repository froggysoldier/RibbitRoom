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

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use(express.static(path.join(__dirname, "public")));

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch(err => console.error("❌ MongoDB Fehler:", err));

// Socket-Events
initSockets(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`✅ Server läuft auf Port ${PORT}`));

import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

async function testMail() {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: "ribbitroomrender@gmail.com", // test-eMail an dich selbst
      subject: "Test-Mail von RibbitRoom",
      text: "Hallo, das ist ein Test!",
      html: "<b>Hallo, das ist ein Test!</b>"
    });

    console.log("Mail gesendet:", info.messageId);
  } catch (err) {
    console.error("Mail-Test fehlgeschlagen:", err);
  }
}

testMail();
