const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const authMiddleware = require("../middleware/auth");

// Nachrichten holen (öffentlich oder optional mit Auth)
router.get("/", async (req, res) => {
  try {
    const messages = await Message.find().sort({ createdAt: -1 }).limit(20);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Laden der Nachrichten" });
  }
});

// Nachricht speichern (nur eingeloggte Nutzer)
router.post("/", authMiddleware, async (req, res) => {
  try {
    const msg = new Message({
      sender: req.user.username, // kommt aus Token
      content: req.body.content
    });
    await msg.save();
    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Speichern der Nachricht" });
  }
});

module.exports = router;
