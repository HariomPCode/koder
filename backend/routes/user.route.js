const express = require("express");
const middleware = require("../middleware");
const User = require("../models/User");
const Submission = require("../models/Submission");
const Questions = require("../models/Question");

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
  try {
    const userId = req.userId;

    const submissions = await Submission.find({ userId });

    const totalSubmissions = submissions.length;

    const solvedQuestions = new Set();
    const attemptedQuestions = new Set();

    let acceptedSubmissions = 0;

    for (const submission of submissions) {
      attemptedQuestions.add(submission.questionId.toString());

      if (submission.verdict === "Accepted") {
        solvedQuestions.add(submission.questionId.toString());
        acceptedSubmissions++;
      }
    }

    const solvedQuestionDocs = await Questions.find({
      _id: { $in: [...solvedQuestions] },
    }).select("difficulty");

    let solvedEasyQuestions = 0;
    let solvedMediumQuestions = 0;
    let solvedHardQuestions = 0;

    for (const question of solvedQuestionDocs) {
      switch (question.difficulty) {
        case "Easy":
          solvedEasyQuestions++;
          break;

        case "Medium":
          solvedMediumQuestions++;
          break;

        case "Hard":
          solvedHardQuestions++;
          break;
      }
    }

    const acceptanceRate =
      totalSubmissions === 0
        ? 0
        : Number(((acceptedSubmissions / totalSubmissions) * 100).toFixed(2));

    return res.json({
      totalSubmissions,

      solvedCount: solvedQuestions.size,
      attemptedCount: attemptedQuestions.size,
      attemptedButUnsolved: attemptedQuestions.size - solvedQuestions.size,

      acceptedSubmissions,
      acceptanceRate,

      solvedEasyQuestions,
      solvedMediumQuestions,
      solvedHardQuestions,

      solvedQuestions: [...solvedQuestions],
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to fetch user statistics.",
    });
  }
});

module.exports = router;
