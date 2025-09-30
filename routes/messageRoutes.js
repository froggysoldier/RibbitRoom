// routes/messageRoutes.js
import express from "express";
import Message from "../models/Message.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

// Nachrichten holen (öffentlich oder optional mit Auth)
router.get("/", async (req, res) => {
  try {
    const messages = await Message.find()
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(messages);
  } catch (err) {
    console.error("Fehler beim Laden der Nachrichten:", err);
    res.status(500).json({ error: "Fehler beim Laden der Nachrichten" });
  }
});

// Nachricht speichern (nur eingeloggte Nutzer)
router.post("/", authMiddleware, async (req, res) => {
  try {
    const msg = new Message({
      sender: req.user.username, // kommt aus Token
      content: req.body.content,
    });
    await msg.save();
    res.status(201).json(msg);
  } catch (err) {
    console.error("Fehler beim Speichern der Nachricht:", err);
    res.status(500).json({ error: "Fehler beim Speichern der Nachricht" });
  }
});

export default router;
