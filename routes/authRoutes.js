const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

// --- Registrierung ---
router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Alle Felder sind erforderlich" });
    }

    // prüfen, ob Benutzername oder E-Mail schon vergeben ist
    const existing = await User.findOne({
      $or: [{ username }, { email }],
    });

    if (existing) {
      return res
        .status(400)
        .json({ error: "Benutzername oder E-Mail bereits vergeben." });
    }

    // Passwort hashen
    const hashedPassword = await bcrypt.hash(password, 10);

    // neuen User speichern
    const user = new User({
      username,
      email,
      password: hashedPassword,
    });

    await user.save();

    res.status(201).json({ message: "Registrierung erfolgreich" });
  } catch (err) {
    console.error("❌ Fehler bei Registrierung:", err);
    res.status(500).json({ error: "Interner Fehler bei Registrierung" });
  }
});

// --- Login ---
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Prüfen ob Felder gesendet wurden
    if (!username || !password) {
      return res.status(400).json({ error: "Benutzername und Passwort erforderlich" });
    }

    // User suchen
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: "Benutzer nicht gefunden" });
    }

    // Prüfen ob Passwort vorhanden ist
    if (!user.password) {
      return res.status(500).json({ error: "Dieser Benutzer hat kein Passwort gesetzt" });
    }

    // Passwort prüfen
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ error: "Falsches Passwort" });
    }

    // Token erstellen
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({ token });
  } catch (err) {
    console.error("❌ Fehler beim Login:", err);
    res.status(500).json({ error: "Interner Fehler beim Login" });
  }
});

module.exports = router;
