const express = require("express");
const middleware = require("../middleware");
const Question = require("../models/Question");
const Submission = require("../models/Submission");
const { queue } = require("../queue");

const router = express.Router();

/*
    / -> get all questions
    post : / -> create a question --- Not a public api

    post : /submission/:questionId -> {lang, code, questionId}

*/

// /page=2&limit=10
router.get("/", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const skip = (page - 1) * limit;
  const questions = await Question.find({})
    .select({
      questionNum: 1,
      title: 1,
      slug: 1,
      difficulty: 1,
      tags: 1,
    })
    .sort({ questionNum: 1 })
    .skip(skip)
    .limit(limit);

  return res.json({
    message: "Questions loaded successfully",
    questions,
  });
});

router.get("/:slug", async (req, res) => {
  const slug = req.params.slug;

  const question = await Question.findOne({ slug }).select({
    hiddenTestCases: 0,
  });

  if (!question) {
    return res.json({
      message: "Invalid request",
    });
  }

  return res.json({
    messgae: "Question fetched successfully",
    question,
  });
});

module.exports = router;
