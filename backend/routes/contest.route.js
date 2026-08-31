const express = require("express");
const ContestService = require("../services/contest.service");
const middleware = require("../middleware");
const AppError = require("../errors/appError");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const result = await ContestService.listContests();
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/:contestId", async (req, res, next) => {
  try {
    const { contestId } = req.params;
    const userId = req.userId || null;
    const result = await ContestService.getContestById({ contestId, userId });
    return res.json(result);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) {
      return res.status(404).json({ message: error.message });
    }
    return next(error);
  }
});

router.post("/:contestId/register", middleware, async (req, res, next) => {
  try {
    const { contestId } = req.params;
    const userId = req.userId;
    const result = await ContestService.registerParticipant({ contestId, userId });
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

router.delete("/:contestId/register", middleware, async (req, res, next) => {
  try {
    const { contestId } = req.params;
    const userId = req.userId;
    const result = await ContestService.unregisterParticipant({ contestId, userId });
    return res.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

router.get("/:contestId/problems", middleware, async (req, res, next) => {
  try {
    const { contestId } = req.params;
    const result = await ContestService.getContestProblems({ contestId, userId: req.userId });
    return res.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

router.post("/:contestId/submissions", middleware, async (req, res, next) => {
  try {
    const { contestId } = req.params;
    const userId = req.userId;
    const payload = req.body || {};
    const result = await ContestService.createContestSubmission({
      contestId,
      userId,
      payload,
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

router.get("/:contestId/submissions", middleware, async (req, res, next) => {
  try {
    const { contestId } = req.params;
    const userId = req.query.userId || req.userId;
    const result = await ContestService.getContestSubmissions({
      contestId,
      userId,
      requesterUserId: req.userId,
    });
    return res.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

module.exports = router;
