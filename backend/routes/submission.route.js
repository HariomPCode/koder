const express = require("express");
const Question = require("../models/Question");
const Submission = require("../models/Submission");
const { jsQueue, javaQueue } = require("../queue");
const middleware = require("../middleware");

const router = express.Router();

router.post("/:questionId", middleware, async (req, res) => {
  const { language, code } = req.body;
  const userId = req.userId;
  const questionId = req.params.questionId;

  const question = await Question.findOne({ _id: questionId });

  if (!question) {
    return res.json({
      message: "Question does not exist",
    });
  }

  const submission = await Submission.create({
    userId,
    questionId,
    code,
    language,
    status: "pending",
  });

  let job;

  if (language === "javascript") {
    job = await jsQueue.add("execute", {
      submissionId: submission._id,
    });
  } else if (language === "java") {
    job = await javaQueue.add("execute", {
      submissionId: submission._id,
    });
  }

  return res.json({
    submissionId: submission._id,
    status: "processing",
  });
});

router.get("/:submissionId", middleware, async (req, res) => {
  try {
    const submission = await Submission.findOne({
      _id: req.params.submissionId,
      userId: req.userId,
    });

    if (!submission) {
      return res.status(404).json({
        message: "Submission not found",
      });
    }

    console.log(submission);

    return res.json({
      submission,
    });
  } catch (error) {
    console.error("Failed to fetch submission:", error);

    return res.status(500).json({
      message: "Failed to fetch submission",
    });
  }
});

router.get("/question/:questionId", middleware, async (req, res) => {
  const { questionId } = req.params;
  const userId = req.userId;

  if (!questionId) {
    return res.json({
      message: "Invalid Question Id",
    });
  }

  const submissions = await Submission.find({
    questionId,
    userId,
  });

  if (submissions.length === 0) {
    return res.json({
      message: "No submissions made for this problem",
    });
  }

  return res.json({
    submissions,
  });
});

module.exports = router;
