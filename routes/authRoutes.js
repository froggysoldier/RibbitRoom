const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const nodemailer = require("nodemailer");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

// --- Mailer einrichten ---
const transporter = nodemailer.createTransport({
  service: "gmail", // oder SMTP-Daten deines Mailanbieters
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-stellig
}

// --- Registrierung ---
router.post("/register", async (req, res) => {
  try {
    const { username, password, email, adminPass } = req.body;
    if (!username || !password || !email) {
      return res.status(400).json({ error: "Bitte alle Felder ausfüllen" });
    }

    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: "Benutzername existiert bereits" });

    const role = adminPass && adminPass === process.env.ADMIN_PASS ? "admin" : "user";

    const user = new User({ username, email, password, role });
    await user.save();

    res.status(201).json({ message: "Registrierung erfolgreich" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler bei der Registrierung" });
  }
});

// --- Login Schritt 1: Passwort prüfen & Code senden ---
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Benutzername und Passwort erforderlich" });
    }

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Benutzer nicht gefunden" });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ error: "Falsches Passwort" });

    // Code generieren und speichern
    const code = generateCode();
    user.verificationCode = code;
    user.codeExpiresAt = Date.now() + 10 * 60 * 1000; // 10 Min gültig
    await user.save();

    // Code per Mail schicken
    await transporter.sendMail({
      from: '"Chat-App" <no-reply@chatapp.com>',
      to: user.email,
      subject: "Dein Login-Code",
      text: `Hallo ${user.username},\n\nDein Login-Code lautet: ${code}\nEr ist 10 Minuten gültig.\n\nViele Grüße\nDein Chat-App-Team`
    });

    res.json({ message: "Bestätigungscode wurde gesendet", step: "code_required" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Login" });
  }
});

// --- Login Schritt 2: Code prüfen & JWT ausgeben ---
router.post("/verify-code", async (req, res) => {
  try {
    const { username, code } = req.body;
    if (!username || !code) return res.status(400).json({ error: "Benutzername und Code erforderlich" });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Benutzer nicht gefunden" });

    if (user.verificationCode !== code) {
      return res.status(400).json({ error: "Falscher Code" });
    }
    if (Date.now() > user.codeExpiresAt) {
      return res.status(400).json({ error: "Code abgelaufen" });
    }

    // Code zurücksetzen
    user.verificationCode = null;
    user.codeExpiresAt = null;
    await user.save();

    // JWT Token erstellen
    const token = jwt.sign(
      { username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler bei der Code-Prüfung" });
  }
});

// --- Logout ---
router.post("/logout", (req, res) => {
  res.json({ message: "Erfolgreich ausgeloggt" });
});

module.exports = router;
