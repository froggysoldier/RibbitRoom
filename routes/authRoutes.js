const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

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
    const token = jwt.sign(
      { username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.status(201).json({ message: "Registrierung erfolgreich", token, role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler bei der Registrierung" });
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
    const token = jwt.sign(
      { username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ token, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Login" });
  }
});

// --- Logout (optional, löscht nur clientseitig das Token) ---
router.post("/logout", (req, res) => {
  // JWT stateless: serverseitig muss nichts gemacht werden
  res.json({ message: "Erfolgreich ausgeloggt" });
});

module.exports = router;

