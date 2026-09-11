const express = require("express");
const middleware = require("../middleware");
const User = require("../models/User");
const UserService = require("../services/user.service");

const router = express.Router();

router.get("/", middleware, async (req, res) => {
  const userId = req.userId;

  const user = await User.findById({ _id: userId }).select({
    password: 0,
  });

  if (!user) {
    return res.json({
      message: "Invalid UserId",
    });
  }

  return res.json({
    user,
  });
});

router.get("/stats", middleware, async (req, res, next) => {
  try {
    return res.json(await UserService.getUserStats(req.userId));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
