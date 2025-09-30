// routes/authRoutes.js
const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const nodemailer = require("nodemailer");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";
const ADMIN_PASS = process.env.ADMIN_PASS || "adminsecret";

// Setup nodemailer transporter:
// Prefer real SMTP via env vars. If none provided, create Ethereal test account (dev only).
async function createTransporter() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: (process.env.SMTP_SECURE === "true"), // true for 465
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  // Dev: ethereal
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

// helper: generate 6-digit numeric code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/auth/register
// body: { username, password, email, adminPass? }
router.post("/register", async (req, res) => {
  try {
    const { username, password, email, adminPass } = req.body;
    if (!username || !password || !email) {
      return res.status(400).json({ error: "Bitte alle Felder ausfüllen" });
    }

    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: "Benutzername existiert bereits" });

    // Rolle optional per adminPass
    const role = adminPass && adminPass === ADMIN_PASS ? "admin" : "user";

    // generate verification code & expiry (e.g. 15min)
    const code = generateVerificationCode();
    const codeExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    const user = new User({
      username,
      email,
      password,
      role,
      verificationCode: code,
      codeExpiresAt
    });
    await user.save();

    // send verification email (async)
    try {
      const transporter = await createTransporter();
      const mail = {
        from: process.env.EMAIL_FROM || '"ChatApp" <no-reply@example.com>',
        to: email,
        subject: "Dein Verifizierungscode",
        text: `Dein Verifizierungscode: ${code}\nGültig für 15 Minuten.`,
        html: `<p>Dein Verifizierungscode: <b>${code}</b></p><p>Gültig für 15 Minuten.</p>`
      };
      const info = await transporter.sendMail(mail);
      // if using ethereal, return preview URL for debugging
      let preview = null;
      if (nodemailer.getTestMessageUrl && info) preview = nodemailer.getTestMessageUrl(info);
      res.status(201).json({ message: "Registrierung erfolgreich. Bitte Code aus E-Mail bestätigen.", preview });
    } catch (mailErr) {
      console.error("Mail error:", mailErr);
      // still create user, but inform client email failed
      res.status(201).json({ message: "Registrierung erstellt, konnte aber keine E-Mail versenden. Bitte Admin kontaktieren." });
    }
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Fehler bei der Registrierung" });
  }
});

// POST /api/auth/verify
// body: { username, code }
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

    // success: clear code fields
    user.verificationCode = undefined;
    user.codeExpiresAt = undefined;
    await user.save();

    // Option: directly return JWT so client logs in after verify
    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ message: "Verifiziert. Du bist nun eingeloggt.", token, role: user.role });
  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: "Fehler bei der Verifikation" });
  }
});

// POST /api/auth/login
// body: { username, password }
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Benutzername und Passwort erforderlich" });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Benutzer nicht gefunden" });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ error: "Falsches Passwort" });

    // Option: require verification before login
    if (user.verificationCode) {
      return res.status(403).json({ error: "Account nicht verifiziert. Bitte Code eingeben." });
    }

    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, role: user.role });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Fehler beim Login" });
  }
});

// helper route for dev/test to resend code (optional)
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
      const info = await transporter.sendMail(mail);
      let preview = null;
      if (nodemailer.getTestMessageUrl && info) preview = nodemailer.getTestMessageUrl(info);
      res.json({ message: "Code versendet", preview });
    } catch (err) {
      console.error("Mail-send failed:", err);
      res.status(500).json({ error: "Konnte keine E-Mail versenden" });
    }
  } catch (err) {
    console.error("resend-code error:", err);
    res.status(500).json({ error: "Fehler" });
  }
});

module.exports = router;
