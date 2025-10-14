const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Nicht eingeloggt" });

  const token = authHeader.split(" ")[1]; // "Bearer TOKEN"
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // User-Daten für die Route verfügbar machen
    next();
  } catch (err) {
    res.status(401).json({ error: "Ungültiger Token" });
  }
};

module.exports = authMiddleware;
