const express = require("express");
const Question = require("../models/Question");
const Submission = require("../models/Submission");
const { jsQueue, javaQueue } = require("../queue");
const middleware = require("../middleware");
const {
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  normalizeLanguage,
} = require("../config/languages");

const router = express.Router();

const LANGUAGE_QUEUES = {
  javascript: jsQueue,
  java: javaQueue,
};

router.post("/:questionId", middleware, async (req, res) => {
  try {
    const { language, code } = req.body;
    const userId = req.userId;
    const questionId = req.params.questionId;

    if (!language || !isSupportedLanguage(language)) {
      return res.status(400).json({
        message: `Unsupported language: '${language}'. Supported languages are: ${SUPPORTED_LANGUAGES.join(", ")}`,
      });
    }

    if (!code || typeof code !== "string" || !code.trim()) {
      return res.status(400).json({
        message: "Code is required",
      });
    }

    const normalizedLang = normalizeLanguage(language);

    const question = await Question.findById(questionId);

    if (!question) {
      return res.status(404).json({
        message: "Question does not exist",
      });
    }

    const targetQueue = LANGUAGE_QUEUES[normalizedLang];
    if (!targetQueue) {
      return res.status(400).json({
        message: `No queue configured for language: ${normalizedLang}`,
      });
    }

    const submission = await Submission.create({
      userId,
      questionId,
      code,
      language: normalizedLang,
      status: "pending",
    });

    await targetQueue.add("execute", {
      submissionId: submission._id,
    });

    return res.status(200).json({
      submissionId: submission._id,
      status: "processing",
    });
  } catch (error) {
    console.error("Submission creation failed:", error);
    return res.status(500).json({
      message: "Failed to process submission",
    });
  }
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
