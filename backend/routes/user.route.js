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

router.get("/stats", middleware, async (req, res, next) => {
  try {
    const userId = req.userId;

    const submissions = await Submission.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

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

    const questions = await Questions.find({})
      .select("title slug difficulty")
      .lean();
    const questionsById = new Map(
      questions.map((question) => [question._id.toString(), question]),
    );

    let solvedEasyQuestions = 0;
    let solvedMediumQuestions = 0;
    let solvedHardQuestions = 0;

    const availableByDifficulty = { Easy: 0, Medium: 0, Hard: 0 };
    for (const question of questions) {
      availableByDifficulty[question.difficulty]++;
      if (!solvedQuestions.has(question._id.toString())) continue;

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

    const recentSubmissions = submissions.slice(0, 5).flatMap((submission) => {
      const question = questionsById.get(submission.questionId.toString());
      if (!question) return [];
      return [{
        question: {
          title: question.title,
          slug: question.slug,
          difficulty: question.difficulty,
        },
        language: submission.language,
        verdict: submission.verdict || submission.status,
        maxRuntime: submission.maxRuntime || 0,
        createdAt: submission.createdAt,
      }];
    });

    const recentlySolved = [];
    const recentSolvedIds = new Set();
    for (const submission of submissions) {
      if (submission.verdict !== "Accepted") continue;
      const questionId = submission.questionId.toString();
      if (recentSolvedIds.has(questionId)) continue;
      const question = questionsById.get(questionId);
      if (!question) continue;
      recentSolvedIds.add(questionId);
      recentlySolved.push({
        title: question.title,
        slug: question.slug,
        difficulty: question.difficulty,
        solvedAt: submission.createdAt,
      });
      if (recentlySolved.length === 5) break;
    }

    const submissionDays = [...new Set(
      submissions.map((submission) => submission.createdAt.toISOString().slice(0, 10)),
    )].sort().reverse();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dayDifference = (from, to) => Math.round((from - to) / 86400000);
    let currentStreak = 0;
    let cursor = new Date(today);
    if (submissionDays[0]) {
      const lastActive = new Date(`${submissionDays[0]}T00:00:00.000Z`);
      if (dayDifference(cursor, lastActive) <= 1) {
        for (const day of submissionDays) {
          const activeDay = new Date(`${day}T00:00:00.000Z`);
          if (dayDifference(cursor, activeDay) !== 0) break;
          currentStreak++;
          cursor.setUTCDate(cursor.getUTCDate() - 1);
        }
      }
    }
    let longestStreak = 0;
    let runningStreak = 0;
    let previousDay = null;
    for (const day of [...submissionDays].reverse()) {
      const activeDay = new Date(`${day}T00:00:00.000Z`);
      if (!previousDay || dayDifference(activeDay, previousDay) === 1) {
        runningStreak++;
      } else {
        runningStreak = 1;
      }
      longestStreak = Math.max(longestStreak, runningStreak);
      previousDay = activeDay;
    }

    const weekStart = new Date(today);
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    const weeklySubmissions = submissions.filter((submission) => submission.createdAt >= weekStart);
    const weeklySolved = new Set(
      weeklySubmissions
        .filter((submission) => submission.verdict === "Accepted")
        .map((submission) => submission.questionId.toString()),
    ).size;
    const weeklyAttempted = new Set(
      weeklySubmissions.map((submission) => submission.questionId.toString()),
    ).size;

    const recommendationOrder = ["Easy", "Medium", "Hard"];
    const recommendedQuestion = recommendationOrder
      .map((difficulty) => questions.find((question) =>
        question.difficulty === difficulty && !solvedQuestions.has(question._id.toString()),
      ))
      .find(Boolean);

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

      availableByDifficulty,
      recentSubmissions,
      recentlySolved,
      activity: {
        currentStreak,
        longestStreak,
        lastActive: submissions[0]?.createdAt || null,
        weeklySolved,
        weeklyAttempted,
      },
      recommendation: recommendedQuestion
        ? {
          title: recommendedQuestion.title,
          slug: recommendedQuestion.slug,
          difficulty: recommendedQuestion.difficulty,
        }
        : null,

      solvedQuestions: [...solvedQuestions],
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
