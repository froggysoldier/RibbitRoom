// routes/fishRoutes.js
const express = require("express");
const router = express.Router();
const FishSave = require("../models/FishSave");
const authenticateToken = require("../middleware/authenticateToken"); // <- deine JWT Middleware

// --- Spielstand laden ---
router.get("/", authenticateToken, async (req, res) => {
  try {
    const save = await FishSave.findOne({ userId: req.user.id });
    res.json({ data: save ? save.data : null });
  } catch (err) {
    console.error("Fehler beim Laden:", err);
    res.status(500).json({ error: "Fehler beim Laden" });
  }
});

// --- Spielstand speichern ---
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { data } = req.body;
    const save = await FishSave.findOneAndUpdate(
      { userId: req.user.id },
      { data, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Fehler beim Speichern:", err);
    res.status(500).json({ error: "Fehler beim Speichern" });
  }
});

module.exports = router;
