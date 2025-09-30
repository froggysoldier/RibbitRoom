import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import User from "../models/User.js";
import sendMail from "../utils/sendMail.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASS = process.env.ADMIN_PASS || "adminsecret";

function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// --- Registrierung ---
router.post("/register", async (req, res) => {
  try {
    const { username, password, email, adminPass } = req.body;
    if (!username || !password || !email) return res.status(400).json({ error: "Alle Felder nötig" });

    if (await User.findOne({ username })) return res.status(400).json({ error: "Benutzername existiert" });

    const role = adminPass && adminPass === ADMIN_PASS ? "admin" : "user";
    const hashed = await bcrypt.hash(password, 10);
    const code = generateVerificationCode();

    const user = new User({
      username,
      password: hashed,
      email,
      role,
      verificationCode: code,
      verified: false
    });
    await user.save();

    // SendGrid Mail senden
    const subject = "RibbitRoom Verifizierungscode";
    const html = `<p>Hallo ${username},</p><p>Dein Code lautet: <b>${code}</b></p>`;
    await sendMail({ to: email, subject, html, text: `Dein Code lautet: ${code}` });

    res.status(201).json({ message: "Registrierung erfolgreich. Bitte Code aus E-Mail bestätigen." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registrierung fehlgeschlagen" });
  }
});

// --- Code verifizieren ---
router.post("/verify", async (req, res) => {
  try {
    const { username, code } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: "User nicht gefunden" });
    if (user.verificationCode !== code) return res.status(403).json({ error: "Code ungültig" });

    user.verified = true;
    user.verificationCode = undefined;
    await user.save();

    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Code-Verifizierung fehlgeschlagen" });
  }
});

// --- Login ---
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: "User nicht gefunden" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(403).json({ error: "Falsches Passwort" });

    if (!user.verified) {
      const code = generateVerificationCode();
      user.verificationCode = code;
      await user.save();

      const subject = "RibbitRoom Verifizierungscode";
      const html = `<p>Hallo ${username},</p><p>Dein Code lautet: <b>${code}</b></p>`;
      await sendMail({ to: user.email, subject, html, text: `Dein Code lautet: ${code}` });

      return res.status(403).json({ error: "Account nicht verifiziert. Code gesendet." });
    }

    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login fehlgeschlagen" });
  }
});

export default router;
