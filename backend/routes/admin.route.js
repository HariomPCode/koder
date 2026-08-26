const express = require("express");
const Question = require("../models/Question");
const User = require("../models/User");
const { generateStarterCode } = require("../../workers/common/templateGenerator");

const router = express.Router();

router.get("/users", async (req, res) => {
  const users = await User.find({});

  return res.json({ users });
});

router.get("/questions", async (req, res) => {
  const questions = await Question.find({}).sort({ questionNum: 1 }).limit(100);

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
    return res.status(404).json({
      message: "Question not found",
    });
  }

  return res.json({
    question,
  });
});

router.post("/questions", async (req, res) => {
  try {
    const data = req.body;
    if (data.slug) {
      data.slug = data.slug.trim().toLowerCase();
    } else if (data.title) {
      data.slug = data.title
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_-]+/g, "-");
    }

    if (!data.questionNum) {
      const lastQ = await Question.findOne().sort({ questionNum: -1 });
      data.questionNum = lastQ ? lastQ.questionNum + 1 : 1;
    }

    if (
      (!data.starterCode || data.starterCode.length === 0) &&
      data.functionName &&
      data.parameters
    ) {
      data.starterCode = generateStarterCode({
        functionName: data.functionName,
        parameters: data.parameters,
        returnType: data.returnType,
      });
    }

    const question = await Question.create(data);

    return res.status(201).json({
      message: "Question created successfully",
      question,
    });
  } catch (err) {
    return res.status(400).json({
      message: "Failed to create question",
      error: err.message,
    });
  }
});

router.put("/questions/:questionId", async (req, res) => {
  try {
    const { questionId } = req.params;
    const data = req.body;

    if (data.slug) {
      data.slug = data.slug.trim().toLowerCase();
    }

    if (
      (!data.starterCode || data.starterCode.length === 0) &&
      data.functionName &&
      data.parameters
    ) {
      data.starterCode = generateStarterCode({
        functionName: data.functionName,
        parameters: data.parameters,
        returnType: data.returnType,
      });
    }

    const question = await Question.findByIdAndUpdate(questionId, data, {
      new: true,
      runValidators: true,
    });

    if (!question) {
      return res.status(404).json({
        message: "Question not found",
      });
    }

    return res.json({
      message: "Question updated successfully",
      question,
    });
  } catch (err) {
    return res.status(400).json({
      message: "Failed to update question",
      error: err.message,
    });
  }
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
