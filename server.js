import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import path from "path";
import { fileURLToPath } from "url";
import sendMail from "./utils/sendMail.js"; // SendGrid Mailer

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Bodyparser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mongoose verbinden
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB verbunden"))
  .catch(err => console.error("MongoDB Fehler:", err));
/*
// Test-Mail
async function testMail() {
  try {
    await sendMail({
      to: "ribbitroomrender@gmail.com",
      subject: "Test-Mail von RibbitRoom",
      text: "Hallo, das ist ein Test!",
      html: "<b>Hallo, das ist ein Test!</b>"
    });
    console.log("Test-Mail gesendet!");
  } catch (err) {
    console.error("Mail-Test fehlgeschlagen:", err);
  }
}

testMail();
*/
// Routes
app.use("/api/auth", authRoutes);

// Public Ordner
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// Start
app.listen(PORT, () => console.log(`Server läuft auf http://localhost:${PORT}`));

