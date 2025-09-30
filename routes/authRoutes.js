// routes/authRoutes.js
import express from "express";
import jwt from "jsonwebtoken";
import sgMail from "@sendgrid/mail";
import User from "../models/User.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";
const ADMIN_PASS = process.env.ADMIN_PASS || "adminsecret";

// SendGrid konfigurieren
if (!process.env.SENDGRID_API_KEY) {
  console.warn("SENDGRID_API_KEY nicht gesetzt! Mails werden nicht verschickt.");
} else {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
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

    const role = adminPass && adminPass === ADMIN_PASS ? "admin" : "user";

    const code = generateVerificationCode();
    const codeExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const user = new User({
      username,
      email,
      password,
      role,
      verificationCode: code,
      codeExpiresAt
    });

    await user.save();

    // --- Mail senden ---
    try {
      if (!process.env.SENDGRID_API_KEY) throw new Error("SendGrid API Key nicht gesetzt");

      const msg = {
        to: email,
        from: process.env.EMAIL_FROM || "no-reply@ribbitroom.com",
        subject: "Dein Verifizierungscode für RibbitRoom",
        text: `Dein Code: ${code} (gültig 15 Minuten)`,
        html: `<p>Dein Verifizierungscode: <b>${code}</b></p><p>Gültig 15 Minuten.</p>`
      };

      await sgMail.send(msg);

      return res.status(201).json({ message: "Registrierung erfolgreich. Bitte Code aus E-Mail eingeben." });
    } catch (mailErr) {
      console.error("Mail send failed:", mailErr);
      // User existiert trotzdem
      return res.status(201).json({
        message: "Registrierung erfolgreich, konnte aber keine E-Mail senden. Bitte Admin kontaktieren.",
        mailFailed: true
      });
    }
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Fehler bei der Registrierung" });
  }
});

// --- Verifizierungscode ---
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

// --- Login ---
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

export default router;
