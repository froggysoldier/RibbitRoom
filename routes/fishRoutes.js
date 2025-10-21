const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

// --- Fortschritt laden ---
router.get("/load", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Kein Token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({ username: decoded.username });
    if (!user) return res.status(404).json({ error: "Nutzer nicht gefunden" });
    res.json(user.fishProgress || {});
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Fortschritt speichern ---
router.post("/save", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Kein Token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    await User.updateOne(
      { username: decoded.username },
      { $set: { fishProgress: req.body } },
      { upsert: false }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
