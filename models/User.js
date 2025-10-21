const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

// === User Schema ================================================
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, default: "user" }, // user oder admim
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
