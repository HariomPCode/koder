const jwt = require("jsonwebtoken");
const User = require("./models/User");

async function authMiddleware(req, res, next) {
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

async function adminMiddleware(req, res, next) {
  if (!req.userId) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(401).json({
        message: "User not found",
      });
    }

    const isAdmin = user.role === "admin";

    if (!isAdmin) {
      return res.status(403).json({
        message: "Access denied. Admin privileges required.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Admin Authorization Error:", error.message);
    return res.status(500).json({
      message: "Authorization check failed",
    });
  }
}

authMiddleware.authMiddleware = authMiddleware;
authMiddleware.adminMiddleware = adminMiddleware;
authMiddleware.requireAdmin = adminMiddleware;

module.exports = authMiddleware;
module.exports.authMiddleware = authMiddleware;
module.exports.adminMiddleware = adminMiddleware;
module.exports.requireAdmin = adminMiddleware;
