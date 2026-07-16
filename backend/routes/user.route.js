const express = require("express");
const middleware = require("../middleware");
const User = require("../models/User");
const Submission = require("../models/Submission");

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

router.get("/stats", middleware, async (req, res) => {
  const userId = req.userId;

  const submissions = await Submission.find({ userId });

  if (submissions.length === 0) {
    return res.json({
      message: "No submissions made by this user",
    });
  }

  const solvedQuestions = new Set();
  const attemptedQuestions = new Set();

  for (const sub of submissions) {
    if (sub.verdict === "Accepted") {
      solvedQuestions.add(sub.questionId.toString());
    }
    attemptedQuestions.add(sub.questionId.toString());
  }

  return res.json({
    solvedQuestions: [...solvedQuestions],
    totalNumberOfAttemptedQuestions:
      attemptedQuestions.size - solvedQuestions.size,
    totalSubmissions: submissions.length,
  });
});

module.exports = router;
