const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  role: { type: String, default: "user" }
}, { timestamps: true });

// Passwort hashen vor dem Speichern
userSchema.pre("save", async function(next) {
  if (!this.isModified("password")) return next();
  try {
    // Wenn das Passwort bereits ein Hash ist, nicht erneut hashen
    if (this.password.startsWith("$2")) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Passwort prüfen (defensiv)
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!candidatePassword || !this.password) return false;
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch {
    return false;
  }
};

module.exports = mongoose.model("User", userSchema);
