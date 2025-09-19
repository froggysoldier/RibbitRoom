// middleware/admin.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

module.exports = async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ error: "Nicht autorisiert" });
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({ username: decoded.username });
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Adminrechte erforderlich" });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token ungültig" });
  }
};
