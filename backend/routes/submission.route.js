const express = require("express");
const middleware = require("../middleware");
const SubmissionService = require("../services/submission.service");
const AppError = require("../errors/appError");

const router = express.Router();

router.post("/:questionId", middleware, async (req, res, next) => {
  try {
    const { language, code } = req.body;
    const userId = req.userId;
    const questionId = req.params.questionId;

    const result = await SubmissionService.createSubmission({
      userId,
      questionId,
      language,
      code,
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) {
      return res.status(404).json({
        message: error.message,
      });
    }

    if (error instanceof AppError && error.statusCode === 400) {
      return res.status(400).json({
        message: error.message,
      });
    }

    if (error instanceof AppError && error.statusCode === 503) {
      return res.status(503).json({
        message: error.message,
      });
    }

    return next(error);
  }
});

router.get("/:submissionId", middleware, async (req, res, next) => {
  try {
    const submission = await SubmissionService.getSubmissionById({
      userId: req.userId,
      submissionId: req.params.submissionId,
    });

    return res.json({ submission });
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) {
      return res.status(404).json({
        message: "Submission not found",
      });
    }
    return next(error);
  }
});

router.get("/question/:questionId", middleware, async (req, res, next) => {
  try {
    const { questionId } = req.params;
    const userId = req.userId;

    if (!questionId) {
      return res.json({
        message: "Invalid Question Id",
      });
    }

    const result = await SubmissionService.getUserQuestionSubmissions({ userId, questionId });
    if (result.message) {
      return res.json({ message: result.message });
    }

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
