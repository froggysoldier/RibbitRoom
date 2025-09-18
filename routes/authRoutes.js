const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
require("dotenv").config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";
const ADMIN_CODE = process.env.ADMIN_CODE || "MeinGeheimerAdminCode123";

// --- Registrierung ---
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, adminCode } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Alle Felder sind erforderlich" });
    }

    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) return res.status(400).json({ error: "Benutzername oder E-Mail bereits vergeben." });

    const hashedPassword = await bcrypt.hash(password, 10);

    // Admin-Code prüfen
    const role = (adminCode && adminCode === ADMIN_CODE) ? "admin" : "user";

    const user = new User({ username, email, password: hashedPassword, role });
    await user.save();

    res.status(201).json({ message: "Registrierung erfolgreich", role });
  } catch (err) {
    console.error("❌ Fehler bei Registrierung:", err);
    res.status(500).json({ error: "Interner Fehler bei Registrierung" });
  }
});

// --- Login ---
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) return res.status(400).json({ error: "Benutzername und Passwort erforderlich" });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Benutzer nicht gefunden" });
    if (!user.password) return res.status(500).json({ error: "Dieser Benutzer hat kein Passwort gesetzt" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Falsches Passwort" });

    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({ token, role: user.role });
  } catch (err) {
    console.error("❌ Fehler beim Login:", err);
    res.status(500).json({ error: "Interner Fehler beim Login" });
  }
});

module.exports = router;
