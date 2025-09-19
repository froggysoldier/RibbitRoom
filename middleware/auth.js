const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "geheimesPasswort";

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Nicht eingeloggt" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // Payload enthält username + role
    next();
  } catch (err) {
    return res.status(401).json({ error: "Ungültiger Token" });
  }
};
