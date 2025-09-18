const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

// --- Registrierung ---
router.post("/register", async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password || !email) {
      return res.status(400).json({ error: "Bitte alle Felder ausfüllen" });
    }

    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: "Benutzername existiert bereits" });

    const user = new User({ username, email, password }); // Plain-text Passwort
    await user.save();

    res.status(201).json({ message: "Registrierung erfolgreich" });
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

    // Passwortprüfung ohne Hashing
    if (user.password !== password) {
      return res.status(400).json({ error: "Falsches Passwort" });
    }

    const token = jwt.sign(
      { username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Login" });
  }
});

module.exports = router;
