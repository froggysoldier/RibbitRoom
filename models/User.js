const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

// === Schema für den Fish Clicker Fortschritt =====================
const FishProgressSchema = new mongoose.Schema({
  fish: { type: Number, default: 0 },
  fpc: { type: Number, default: 1 },
  fps: { type: Number, default: 0 },
  BoughtUpgrade0: { type: Number, default: 0 },
  BoughtUpgrade1: { type: Number, default: 0 },
  BoughtUpgrade2: { type: Number, default: 0 },
  BoughtUpgrade3: { type: Number, default: 0 },
  Upgrade0Preis: { type: Number, default: 15 },
  Upgrade1Preis: { type: Number, default: 100 },
  Upgrade2Preis: { type: Number, default: 1000 },
  Upgrade3Preis: { type: Number, default: 5000 },
  clickerX: { type: String, default: null },
  clickerY: { type: String, default: null },
  slideBoxVisible: { type: Boolean, default: false },
  slideBoxRight: { type: String, default: null }
}, { _id: false });

// === User Schema ================================================
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, default: "user" }, // user oder admin
  fishProgress: { type: FishProgressSchema, default: () => ({}) }, // neu hinzugefügt
  createdAt: { type: Date, default: Date.now }
});

// === Password Hash vor Save =====================================
UserSchema.pre("save", async function(next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// === Passwort vergleichen =======================================
UserSchema.methods.comparePassword = async function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model("User", UserSchema);
