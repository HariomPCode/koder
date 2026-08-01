const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const router = express.Router();

router.post("/signup", async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  if (!firstName || !lastName || !email || !password) {
    return res.json({
      message: "All fields are required",
    });
  }

  const user = await User.findOne({ email });

  if (user) {
    return res.json({
      message: "User already exists",
    });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const userCreated = await User.create({
    firstName,
    lastName,
    email,
    password: hashedPassword,
  });

  const token = await jwt.sign(
    { userId: userCreated._id },
    process.env.JWT_SECRET,
    { expiresIn: "30d" },
  );

  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  return res.json({
    message: "User Created Successfully",
  });
});

router.post("/signin", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.json({
      message: "Email or password is missing",
    });
  }

  const checkUser = await User.findOne({ email });

  if (!checkUser) {
    return res.json({
      message: "Either email or password is incorrect",
    });
  }

  const checkHashed = await bcrypt.compare(password, checkUser.password);

  if (!checkHashed) {
    return res.json({
      message: "Either email or password is incorrect",
    });
  }

  const token = await jwt.sign(
    { userId: checkUser._id },
    process.env.JWT_SECRET,
    { expiresIn: "30d" },
  );

  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  return res.json({
    message: "User signed in successfully",
  });
});

router.post("/signout", (req, res) => {
  res.clearCookie("auth_token", {
    httpOnly: true,
  });

  return res.json({
    message: "User signed out successfully",
  });
});

module.exports = router;
