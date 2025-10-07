// routes/authRoutes.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import sendMail from "../utils/sendMail.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "superSecretToken";

function createToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/**
 * ===========================
 *  REGISTRIERUNG MIT CODE
 * ===========================
 */
router.post("/register", async (req, res) => {
  try {
    const { username, password, email, adminPass } = req.body;

    if (!username || !password || !email)
      return res.status(400).json({ error: "Alle Felder erforderlich." });

    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: "Benutzername existiert bereits." });

    // Adminrolle prüfen
    const role =
      adminPass && process.env.ADMIN_PASS && adminPass === process.env.ADMIN_PASS
        ? "admin"
        : "user";

    // Verifizierungscode generieren
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Benutzer temporär speichern (unverified)
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      email,
      password: hashed,
      role,
      verificationCode,
      verified: false,
    });

    // Code senden
    try {
      await sendMail({
        to: email,
        subject: "Dein Verifizierungscode",
        text: `Dein Code lautet: ${verificationCode}`,
      });
      console.log(`📧 Code gesendet an ${email}`);
    } catch (err) {
      console.error("SendGrid Fehler:", err);
      return res.status(500).json({ error: "E-Mail konnte nicht gesendet werden." });
    }

    res.json({
      message: "Verifizierungscode wurde gesendet. Bitte bestätige deinen Account.",
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Serverfehler bei Registrierung." });
  }
});

/**
 * ===========================
 *  CODE-VERIFIZIERUNG
 * ===========================
 */
router.post("/verify", async (req, res) => {
  try {
    const { username, code } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Benutzer nicht gefunden." });

    if (user.verificationCode !== code)
      return res.status(400).json({ error: "Falscher Code." });

    user.verified = true;
    user.verificationCode = null;
    await user.save();

    const token = createToken(user);
    res.json({ message: "Verifiziert!", token, role: user.role });
  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: "Serverfehler bei Verifizierung." });
  }
});

/**
 * ===========================
 *  LOGIN OHNE CODE
 * ===========================
 */
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.status(400).json({ error: "Benutzername und Passwort erforderlich." });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Benutzer nicht gefunden." });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "Falsches Passwort." });

    if (!user.verified)
      return res
        .status(403)
        .json({ error: "Bitte bestätige zuerst deinen Account per E-Mail-Code." });

    const token = createToken(user);
    res.json({ token, role: user.role });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Serverfehler beim Login." });
  }
});

export default router;
