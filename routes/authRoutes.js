// routes/authRoutes.js
import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import nodemailer from "nodemailer";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";
const ADMIN_PASS = process.env.ADMIN_PASS || "adminsecret";

// Setup nodemailer transporter
async function createTransporter() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  // Dev: Ethereal fallback
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass
    }
  });
}

// 6-stelliger Code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Registrierung
router.post("/register", async (req, res) => {
  try {
    const { username, password, email, adminPass } = req.body;
    if (!username || !password || !email)
      return res.status(400).json({ error: "Bitte alle Felder ausfüllen" });

    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: "Benutzername existiert bereits" });

    const role = adminPass && adminPass === ADMIN_PASS ? "admin" : "user";

    const code = generateVerificationCode();
    const codeExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const user = new User({ username, email, password, role, verificationCode: code, codeExpiresAt });
    await user.save();

    try {
      const transporter = await createTransporter();
      const mail = {
        from: process.env.EMAIL_FROM || '"ChatApp" <no-reply@example.com>',
        to: email,
        subject: "Dein Verifizierungscode",
        text: `Dein Verifizierungscode: ${code}\nGültig für 15 Minuten.`,
        html: `<p>Dein Verifizierungscode: <b>${code}</b></p><p>Gültig für 15 Minuten.</p>`
      };
      await transporter.sendMail(mail);
      res.status(201).json({ message: "Registrierung erfolgreich. Bitte Code aus E-Mail bestätigen." });
    } catch (mailErr) {
      console.error("Mail error:", mailErr);
      res.status(201).json({ message: "Registrierung erstellt, konnte aber keine E-Mail versenden. Bitte Admin kontaktieren." });
    }
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Fehler bei der Registrierung" });
  }
});

// Code bestätigen
router.post("/verify", async (req, res) => {
  try {
    const { username, code } = req.body;
    if (!username || !code) return res.status(400).json({ error: "Benutzername und Code erforderlich" });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Benutzer nicht gefunden" });

    if (!user.verificationCode || !user.codeExpiresAt) return res.status(400).json({ error: "Kein Verifizierungscode vorhanden" });

    if (new Date() > user.codeExpiresAt) {
      user.verificationCode = undefined;
      user.codeExpiresAt = undefined;
      await user.save();
      return res.status(400).json({ error: "Code abgelaufen" });
    }

    if (user.verificationCode !== String(code).trim()) {
      return res.status(400).json({ error: "Ungültiger Code" });
    }

    user.verificationCode = undefined;
    user.codeExpiresAt = undefined;
    await user.save();

    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ message: "Verifiziert. Du bist nun eingeloggt.", token, role: user.role });
  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: "Fehler bei der Verifikation" });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Benutzername und Passwort erforderlich" });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Benutzer nicht gefunden" });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ error: "Falsches Passwort" });

    if (user.verificationCode)
      return res.status(403).json({ error: "Account nicht verifiziert. Bitte Code eingeben." });

    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, role: user.role });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Fehler beim Login" });
  }
});

// Code erneut senden
router.post("/resend-code", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Benutzername erforderlich" });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Benutzer nicht gefunden" });

    const code = generateVerificationCode();
    user.verificationCode = code;
    user.codeExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    try {
      const transporter = await createTransporter();
      const mail = {
        from: process.env.EMAIL_FROM || '"ChatApp" <no-reply@example.com>',
        to: user.email,
        subject: "Neuer Verifizierungscode",
        text: `Dein neuer Verifizierungscode: ${code}\nGültig für 15 Minuten.`,
        html: `<p>Dein neuer Verifizierungscode: <b>${code}</b></p><p>Gültig für 15 Minuten.</p>`
      };
      await transporter.sendMail(mail);
      res.json({ message: "Code versendet" });
    } catch (err) {
      console.error("Mail-send failed:", err);
      res.status(500).json({ error: "Konnte keine E-Mail versenden" });
    }
  } catch (err) {
    console.error("resend-code error:", err);
    res.status(500).json({ error: "Fehler" });
  }
});

export default router;

