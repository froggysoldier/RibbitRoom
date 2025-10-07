import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  sender: String,
  content: String,
  senderRole: { type: String, default: "user" }, // Rolle speichern
  createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.model("Message", messageSchema);
export default Message;
