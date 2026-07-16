const express = require("express");
const Question = require("../models/Question");
const User = require("../models/User");

const router = express.Router();

router.get("/users", async (req, res) => {
  const users = await User.find({});

  return res.json({ users });
});

router.get("/questions", async (req, res) => {
  const questions = await Question.find({}).limit(100);

  if (questions.length === 0) {
    return res.status(404).json({
      message: "No questions found",
    });
  }

  return res.json({
    questions,
  });
});

router.get("/questions/:questionId", async (req, res) => {
  const questionId = req.params.questionId;

  const question = await Question.findById(questionId);

  if (!question) {
    return res.json({
      message: "Question not found",
    });
  }

  return res.json({
    question,
  });
});

router.post("/questions", async (req, res) => {
  const data = req.body;
  data.slug = data.slug.trim().toLowerCase();

  const question = await Question.create(data);

  if (!question) {
    return res.json({
      message: "something went wrong",
    });
  }

  return res.json({
    question,
  });
});

router.delete("/questions/:questionId", async (req, res) => {
  try {
    const { questionId } = req.params;

    const question = await Question.findById(questionId);

    if (!question) {
      return res.status(404).json({
        message: "Question not found",
      });
    }

    await Question.findByIdAndDelete(questionId);

    return res.status(200).json({
      message: "Question deleted successfully",
    });
  } catch (err) {
    return res.status(500).json({
      message: "Unable to process your request",
      error: err.message,
    });
  }
});

module.exports = router;
