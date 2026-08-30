const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const UserRepository = require("../repositories/user.repository");
const { validateSignupPayload, validateAuthPayload } = require("../validators/request.validators");
const AppError = require("../errors/appError");

const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

async function signup({ firstName, lastName, email, password }) {
  validateSignupPayload({ firstName, lastName, email, password });

  const existingUser = await UserRepository.findByEmail(email.trim().toLowerCase());
  if (existingUser) {
    throw AppError.conflict("User already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const userCreated = await UserRepository.create({
    firstName,
    lastName,
    email: email.trim().toLowerCase(),
    password: hashedPassword,
    role: "user",
  });

  const token = jwt.sign({ userId: userCreated._id }, process.env.JWT_SECRET, { expiresIn: "30d" });

  return {
    user: userCreated,
    token,
  };
}

async function signin({ email, password }) {
  validateAuthPayload({ email, password });

  const normalizedEmail = email.trim().toLowerCase();
  const checkUser = await UserRepository.findByEmail(normalizedEmail);

  if (!checkUser) {
    throw AppError.badRequest("Either email or password is incorrect");
  }

  const isMatch = await bcrypt.compare(password, checkUser.password);
  if (!isMatch) {
    throw AppError.badRequest("Either email or password is incorrect");
  }

  const token = jwt.sign({ userId: checkUser._id }, process.env.JWT_SECRET, { expiresIn: "30d" });

  return {
    user: checkUser,
    token,
  };
}

function getAuthCookieOptions() {
  return authCookieOptions;
}

module.exports = {
  signup,
  signin,
  getAuthCookieOptions,
};
