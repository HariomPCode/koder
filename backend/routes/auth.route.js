const express = require("express");
const AuthService = require("../services/auth.service");
const AppError = require("../errors/appError");
const router = express.Router();

const authCookieOptions = AuthService.getAuthCookieOptions();

router.post("/signup", async (req, res, next) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.json({
        message: "All fields are required",
      });
    }

    const { token } = await AuthService.signup({ firstName, lastName, email, password });

    res.cookie("auth_token", token, authCookieOptions);

    return res.json({
      message: "User Created Successfully",
    });
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 409) {
      return res.json({
        message: "User already exists",
      });
    }

    if (error instanceof AppError && error.statusCode === 400) {
      return res.json({
        message: error.message,
      });
    }

    return next(error);
  }
});

router.post("/signin", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.json({
        message: "Email or password is missing",
      });
    }

    const { token } = await AuthService.signin({ email, password });

    res.cookie("auth_token", token, authCookieOptions);

    return res.json({
      message: "User signed in successfully",
    });
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 400) {
      return res.json({
        message: "Either email or password is incorrect",
      });
    }

    return next(error);
  }
});

router.post("/signout", (req, res) => {
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: authCookieOptions.secure,
    sameSite: authCookieOptions.sameSite,
    path: authCookieOptions.path,
  });

  return res.json({
    message: "User signed out successfully",
  });
});

module.exports = router;
