const express = require("express");
const QuestionService = require("../services/question.service");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const questions = await QuestionService.listQuestions({ page, limit });

    return res.json({
      message: "Questions loaded successfully",
      questions,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const question = await QuestionService.getQuestionBySlug(slug);

    if (!question) {
      return res.json({
        message: "Invalid request",
      });
    }

    return res.json({
      message: "Question fetched successfully",
      question,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
