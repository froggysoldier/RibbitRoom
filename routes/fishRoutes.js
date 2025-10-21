// routes/fishRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

// GET /api/fish    -> lädt Spielstand des eingeloggten Nutzers
router.get("/", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Kein Token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const username = decoded.username;
    const user = await User.findOne({ username }).select("fishProgress");
    if (!user) return res.status(404).json({ error: "Nutzer nicht gefunden" });
    res.json({ data: user.fishProgress || {} });
  } catch (err) {
    console.error("GET /api/fish Fehler:", err);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/fish   -> speichert Spielstand für eingeloggten Nutzer
router.post("/", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Kein Token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const username = decoded.username;
    const data = req.body.data || req.body; // akzeptiere { data: {...} } oder direkt {...}

    const update = { fishProgress: data, updatedAt: new Date() };
    const result = await User.findOneAndUpdate(
      { username },
      { $set: update },
      { new: true }
    );

    if (!result) return res.status(404).json({ error: "Nutzer nicht gefunden" });
    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/fish Fehler:", err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
