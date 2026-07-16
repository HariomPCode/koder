const express = require("express");
const authRoutes = require("./authRoutes");
const questionRoutes = require("./questionRoutes");
const submissionRoutes = require("./submission.route");
const userRoutes = require("./user.route");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/user", userRoutes);
router.use("/questions", questionRoutes);
router.use("/submissions", submissionRoutes);

module.exports = router;
