const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

// REGISTRIEREN
router.post("/register", async (req, res) => {
  const { username, password } = req.body;
  const existing = await User.findOne({ username });
  if (existing) return res.status(400).json({ error: "Username vergeben" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = new User({ username, passwordHash });
  await user.save();
  res.json({ message: "User registriert" });
});

// LOGIN
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: "User nicht gefunden" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(400).json({ error: "Falsches Passwort" });

  const token = jwt.sign(
    { userId: user._id, username: user.username },
    JWT_SECRET,
    { expiresIn: "2h" }
  );

  res.json({ token });
});

module.exports = router;
