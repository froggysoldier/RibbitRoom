import express from "express";
import jwt from "jsonwebtoken";
import sgMail from "@sendgrid/mail";
import User from "../models/User.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";
const ADMIN_PASS = process.env.ADMIN_PASS || "adminsecret";

// === SendGrid Setup ===
if (!process.env.SENDGRID_API_KEY) {
  console.warn("⚠️ SENDGRID_API_KEY nicht gesetzt! Keine Mails werden versendet.");
} else {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const FROM_EMAIL = process.env.EMAIL_FROM || "Ribbit Room <no-reply@ribbitroom.com>";

function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// === REGISTRIERUNG ===
router.post("/register", async (req, res) => {
  try {
    const { username, password, email, adminPass } = req.body;
    if (!username || !password || !email) {
      return res.status(400).json({ error: "Bitte alle Felder ausfüllen." });
    }

    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: "Benutzername existiert bereits." });

    const role = adminPass && adminPass === ADMIN_PASS ? "admin" : "user";
    const code = generateVerificationCode();
    const codeExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 Minuten gültig

    const user = new User({
      username,
      password,
      email,
      role,
      verificationCode: code,
      codeExpiresAt
    });

    await user.save();

    // === MAIL SENDEN ===
    if (!process.env.SENDGRID_API_KEY) {
      console.warn("⚠️ Kein SendGrid API Key gesetzt – überspringe Mailversand");
      return res.status(201).json({
        message: "Registrierung erfolgreich, aber kein Mailversand möglich.",
        mailFailed: true
      });
    }

    const msg = {
      to: email,
      from: FROM_EMAIL,
      subject: "🐸 Dein RibbitRoom Bestätigungscode",
      text: `Dein Code lautet: ${code} (gültig für 15 Minuten).`,
      html: `<p>Willkommen bei RibbitRoom! 🐸</p>
             <p>Dein Verifizierungscode lautet: <b>${code}</b></p>
             <p>Gültig für 15 Minuten.</p>`
    };

    try {
      await sgMail.send(msg);
      return res.status(201).json({
        message: "Registrierung erfolgreich! 📧 Bitte überprüfe deine E-Mail für den Code."
      });
    } catch (mailErr) {
      console.error("❌ Mailversand fehlgeschlagen:", mailErr.response?.body || mailErr.message);
      return res.status(201).json({
        message: "Registrierung erfolgreich, aber Mailversand fehlgeschlagen.",
        mailFailed: true
      });
    }
  } catch (err) {
    console.error("❌ Fehler bei Registrierung:", err);
    res.status(500).json({ error: "Serverfehler bei Registrierung." });
  }
});

// === VERIFIZIERUNG ===
router.post("/verify", async (req, res) => {
  try {
    const { username, code } = req.body;
    if (!username || !code)
      return res.status(400).json({ error: "Benutzername und Code erforderlich." });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Benutzer nicht gefunden." });

    if (!user.verificationCode || !user.codeExpiresAt)
      return res.status(400).json({ error: "Kein aktiver Code vorhanden." });

    if (new Date() > user.codeExpiresAt)
      return res.status(400).json({ error: "Code ist abgelaufen. Bitte erneut registrieren." });

    if (String(code).trim() !== user.verificationCode)
      return res.status(400).json({ error: "Ungültiger Code." });

    // Code korrekt
    user.verificationCode = undefined;
    user.codeExpiresAt = undefined;
    await user.save();

    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "7d" });

    res.json({ message: "Verifizierung erfolgreich!", token, role: user.role });
  } catch (err) {
    console.error("❌ Verify error:", err);
    res.status(500).json({ error: "Serverfehler bei Verifikation." });
  }
});

// === LOGIN ===
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "Bitte Benutzername und Passwort eingeben." });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Benutzer nicht gefunden." });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ error: "Falsches Passwort." });

    if (user.verificationCode)
      return res.status(403).json({ error: "Account noch nicht verifiziert." });

    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "7d" });

    res.json({ token, role: user.role });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: "Serverfehler beim Login." });
  }
});

export default router;
