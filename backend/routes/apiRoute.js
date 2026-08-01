const express = require("express");
const authRoutes = require("./auth.route");
const questionRoutes = require("./question.route");
const submissionRoutes = require("./submission.route");
const userRoutes = require("./user.route");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/user", userRoutes);
router.use("/questions", questionRoutes);
router.use("/submissions", submissionRoutes);

module.exports = router;
