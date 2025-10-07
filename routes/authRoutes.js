// routes/authRoutes.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import sendMail from "../utils/sendMail.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const TOKEN_EXPIRY = "7d";

function createToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

/**
 * POST /api/auth/register
 * - speichert user mit verificationCode
 * - sendet Mail; gibt mailFailed bei Send-Fehler zurück
 */
router.post("/register", async (req, res) => {
  try {
    const { username, password, email, adminPass } = req.body;
    if (!username || !password || !email) {
      return res.status(400).json({ error: "Benutzername, Passwort und E-Mail erforderlich." });
    }

    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: "Benutzername existiert bereits." });

    const role = adminPass && process.env.ADMIN_PASS && adminPass === process.env.ADMIN_PASS ? "admin" : "user";

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      email,
      password, // <-- rohes Passwort hier; UserSchema.pre('save') hash't es automatisch
      role,
      verificationCode,
      verified: false,
      codeExpiresAt: Date.now() + 1000 * 60 * 60
    });


    // Mail senden
    const mailRes = await sendMail({
      to: email,
      subject: "RibbitRoom: Dein Verifizierungscode",
      text: `Dein Verifizierungscode: ${verificationCode}`,
      html: `<p>Dein Verifizierungscode: <b>${verificationCode}</b></p>`
    });

    if (!mailRes.ok) {
      console.error("[authRoutes] Mail konnte NICHT gesendet werden:", mailRes.error);
      // Wir behalten User in DB, geben aber mailFailed zurück
      return res.status(500).json({ error: "E-Mail konnte nicht gesendet werden.", mailFailed: true });
    }

    console.log(`📧 Code gesendet an ${email}`);
    return res.json({ message: "Verifizierungscode wurde gesendet. Bitte E-Mail prüfen." });
  } catch (err) {
    console.error("[authRoutes] Register-Fehler:", err);
    return res.status(500).json({ error: "Serverfehler bei Registrierung." });
  }
});

/**
 * POST /api/auth/verify
 * - bestätigt code, setzt verified=true und gibt Token zurück
 */
router.post("/verify", async (req, res) => {
  try {
    const { username, code } = req.body;
    if (!username || !code) return res.status(400).json({ error: "Benutzername & Code erforderlich." });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Benutzer nicht gefunden." });

    if (user.verificationCode !== code) return res.status(400).json({ error: "Falscher Code." });
    if (user.codeExpiresAt && Date.now() > user.codeExpiresAt) return res.status(400).json({ error: "Code abgelaufen." });

    user.verified = true;
    user.verificationCode = null;
    user.codeExpiresAt = null;
    await user.save();

    const token = createToken(user);
    return res.json({ token, role: user.role, message: "Verifiziert & eingeloggt." });
  } catch (err) {
    console.error("[authRoutes] Verify-Fehler:", err);
    return res.status(500).json({ error: "Serverfehler bei Verifizierung." });
  }
});

/**
 * POST /api/auth/login
 * - login nur mit username+password (kein Code)
 * - User muss zuvor verified=true sein
 */
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Benutzername & Passwort erforderlich." });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Benutzer nicht gefunden." });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "Falsches Passwort." });

    if (!user.verified) {
      // Der Client kann dann die Code-Modal öffnen
      return res.status(403).json({ error: "Nicht verifiziert. Bitte Code eingeben." });
    }

    const token = createToken(user);
    return res.json({ token, role: user.role });
  } catch (err) {
    console.error("[authRoutes] Login-Fehler:", err);
    return res.status(500).json({ error: "Serverfehler beim Login." });
  }
});

export default router;

