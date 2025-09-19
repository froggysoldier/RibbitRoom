const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender: {
    username: { type: String, required: true },
    role: { type: String, default: "user" } // "user" oder "admin"
  },
  content: { type: String, required: true },
  type: { type: String, default: "user" }, // "user" oder "system"
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Message", messageSchema);
