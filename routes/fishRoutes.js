const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

// GET /api/fish -> Fortschritt laden
router.get("/", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Kein Token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({ username: decoded.username }).select("fishProgress");
    if (!user) return res.status(404).json({ error: "User nicht gefunden" });
    res.json({ fishProgress: user.fishProgress || {} });
  } catch (err) {
    console.error("GET /api/fish Fehler:", err);
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/fish -> Fortschritt speichern
router.put("/", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Kein Token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({ username: decoded.username });
    if (!user) return res.status(404).json({ error: "User nicht gefunden" });

    const data = req.body.fishProgress;
    if (!data) return res.status(400).json({ error: "Keine Daten übergeben" });

    user.fishProgress = data;
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error("PUT /api/fish Fehler:", err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
