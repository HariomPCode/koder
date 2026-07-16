const express = require("express");
const Question = require("../models/Question");
const Submission = require("../models/Submission");
const { queue } = require("../queue");
const middleware = require("../middleware");

const router = express.Router();

router.post("/:questionId", middleware, async (req, res) => {
  const { language, code } = req.body;
  const userId = req.userId;
  const questionId = req.params.questionId;

  const question = await Question.findOne({ _id: questionId });

  if (!question) {
    return res.json({
      messgae: "Question does not exist",
    });
  }

  const submission = await Submission.create({
    userId,
    questionId,
    code,
    language,
    status: "pending",
  });

  const job = await queue.add("execute", {
    submissionId: submission._id,
  });

  return res.json({
    jobId: job.id,
    status: "processing",
  });
});

router.get("/:jobId", middleware, async (req, res) => {
  const job = await queue.getJob(req.params.jobId);

  if (!job) {
    return res.status(404).json({
      message: "Job not found",
    });
  }

  const submission = await Submission.findById({ _id: job.data.submissionId });

  return res.json({
    submission,
  });
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
