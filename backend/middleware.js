const jwt = require("jsonwebtoken");

async function middleware(req, res, next) {
  const token = req.cookies?.auth_token;

  if (!token) {
    return res.status(401).json({
      message: "Unauthenticated User",
    });
  }

  try {
    const decoded = await jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;

    next();
  } catch (error) {
    console.error("JWT Verification Error:", error.message);
    return res.status(403).json({ message: "Invalid or expired token" });
  }
}

module.exports = middleware;
