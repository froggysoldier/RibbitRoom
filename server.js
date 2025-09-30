import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import authRoutes from "./routes/authRoutes.js"; // ES Module import
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Bodyparser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mongoose verbinden
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("MongoDB verbunden"))
.catch(err => console.error("MongoDB Fehler:", err));

// Routes
app.use("/api/auth", authRoutes);

// Public Ordner
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));
async function testMail() {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      logger: true,
      debug: true
    });

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: "deineEmail@example.com",  // teste erstmal an dich selbst
      subject: "Test-Mail RibbitRoom",
      text: "Hallo, das ist ein Test!",
      html: "<b>Hallo, das ist ein Test!</b>",
    });

    console.log("Mail gesendet:", info.messageId);
  } catch (err) {
    console.error("Mail-Test fehlgeschlagen:", err);
  }
}

testMail();



// Start
app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});






