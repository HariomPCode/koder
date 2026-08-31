const express = require("express");
const Question = require("../models/Question");
const User = require("../models/User");
const ContestService = require("../services/contest.service");
const { authMiddleware, adminMiddleware } = require("../middleware");
const {
  generateStarterCode,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
} = require("@koder/shared");


const router = express.Router();

router.use(authMiddleware);
router.use(adminMiddleware);

router.get("/users", async (req, res, next) => {
  try {
    const users = await User.find({}).select({ password: 0 });

    return res.json({ users });
  } catch (error) {
    return next(error);
  }
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

router.post("/questions", async (req, res, next) => {
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

    if (data.starterCode !== undefined && data.starterCode !== null) {
      if (!Array.isArray(data.starterCode)) {
        return res.status(400).json({
          message: "starterCode must be an array",
        });
      }
      for (const item of data.starterCode) {
        if (!item || typeof item !== "object" || !item.language || !isSupportedLanguage(item.language)) {
          return res.status(400).json({
            message: `Unsupported or invalid language in starterCode: '${item?.language}'. Supported languages are: ${SUPPORTED_LANGUAGES.join(", ")}`,
          });
        }
      }
    }

    const question = await Question.create(data);

    return res.status(201).json({
      message: "Question created successfully",
      question,
    });
  } catch (err) {
    return next(err);
  }
});

router.put("/questions/:questionId", async (req, res, next) => {
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

    if (data.starterCode !== undefined && data.starterCode !== null) {
      if (!Array.isArray(data.starterCode)) {
        return res.status(400).json({
          message: "starterCode must be an array",
        });
      }
      for (const item of data.starterCode) {
        if (!item || typeof item !== "object" || !item.language || !isSupportedLanguage(item.language)) {
          return res.status(400).json({
            message: `Unsupported or invalid language in starterCode: '${item?.language}'. Supported languages are: ${SUPPORTED_LANGUAGES.join(", ")}`,
          });
        }
      }
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
    return next(err);
  }
});

router.delete("/questions/:questionId", async (req, res, next) => {
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
    return next(err);
  }
});

router.get("/contests", async (req, res, next) => {
  try {
    const result = await ContestService.listContests();
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/contests/:contestId", async (req, res, next) => {
  try {
    const { contestId } = req.params;
    const result = await ContestService.getContestById({ contestId, userId: req.userId });
    return res.json(result);
  } catch (error) {
    if (error && error.statusCode === 404) {
      return res.status(404).json({ message: error.message });
    }
    return next(error);
  }
});

router.post("/contests", async (req, res, next) => {
  try {
    const result = await ContestService.createContest({
      createdBy: req.userId,
      payload: req.body || {},
    });
    return res.status(201).json(result);
  } catch (error) {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

router.patch("/contests/:contestId", async (req, res, next) => {
  try {
    const { contestId } = req.params;
    const result = await ContestService.updateContest({
      contestId,
      actorUserId: req.userId,
      payload: req.body || {},
    });
    return res.json(result);
  } catch (error) {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

router.post("/contests/:contestId/start", async (req, res, next) => {
  try {
    const { contestId } = req.params;
    const result = await ContestService.transitionContestStatus({
      contestId,
      targetStatus: ContestService.CONTEST_STATUS.RUNNING,
      actorUserId: req.userId,
    });
    return res.json(result);
  } catch (error) {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

router.post("/contests/:contestId/end", async (req, res, next) => {
  try {
    const { contestId } = req.params;
    const result = await ContestService.transitionContestStatus({
      contestId,
      targetStatus: ContestService.CONTEST_STATUS.ENDED,
      actorUserId: req.userId,
    });
    return res.json(result);
  } catch (error) {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

router.post("/contests/:contestId/finalize", async (req, res, next) => {
  try {
    const { contestId } = req.params;
    const result = await ContestService.finalizeContest({
      contestId,
      actorUserId: req.userId,
    });
    return res.json(result);
  } catch (error) {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

module.exports = router;
