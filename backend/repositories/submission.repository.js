const { Submission, SUBMISSION_STATUS } = require("@koder/shared");
const crypto = require("crypto");
const mongoose = require("mongoose");

class SubmissionRepository {
  async create(data) {
    return Submission.create(data);
  }

  async findById(submissionId) {
    return Submission.findById(submissionId);
  }

  async updateStatus(submissionId, status) {
    if (!Submission || !Submission.findByIdAndUpdate || Submission.db?.readyState === 0) {
      return null;
    }

    return Submission.findByIdAndUpdate(
      submissionId,
      { status },
      { returnDocument: "after", runValidators: true },
    );
  }

  async updateStatusIfCurrent(submissionId, currentStatus, nextStatus) {
    if (!Submission || !Submission.findOneAndUpdate || Submission.db?.readyState === 0) {
      return null;
    }

    return Submission.findOneAndUpdate(
      { _id: submissionId, status: currentStatus },
      { status: nextStatus },
      { returnDocument: "after", runValidators: true },
    );
  }

  async findStaleCreatedSubmissions({ cutoff, limit = 100 } = {}) {
    return Submission.find({
      status: SUBMISSION_STATUS.CREATED,
      createdAt: { $lt: cutoff },
    })
      .sort({ createdAt: 1 })
      .limit(limit)
      .select("_id userId questionId contestId language status createdAt")
      .lean();
  }

  async getUserStatsSummary(userId) {
    const normalizedUserId = new mongoose.Types.ObjectId(String(userId));
    const [summary] = await Submission.aggregate([
      { $match: { userId: normalizedUserId } },
      {
        $group: {
          _id: null,
          totalSubmissions: { $sum: 1 },
          acceptedSubmissions: {
            $sum: {
              $cond: [{ $eq: ["$verdict", "Accepted"] }, 1, 0],
            },
          },
          attemptedQuestionIds: { $addToSet: "$questionId" },
          solvedQuestionIds: {
            $addToSet: {
              $cond: [
                { $eq: ["$verdict", "Accepted"] },
                "$questionId",
                null,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalSubmissions: 1,
          acceptedSubmissions: 1,
          attemptedQuestionIds: 1,
          solvedQuestionIds: {
            $setDifference: ["$solvedQuestionIds", [null]],
          },
        },
      },
    ]);

    return summary || {
      totalSubmissions: 0,
      acceptedSubmissions: 0,
      attemptedQuestionIds: [],
      solvedQuestionIds: [],
    };
  }

  async getUserActivityDays(userId) {
    const normalizedUserId = new mongoose.Types.ObjectId(String(userId));
    return Submission.aggregate([
      { $match: { userId: normalizedUserId } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: "UTC",
            },
          },
        },
      },
      { $sort: { _id: -1 } },
    ]);
  }

  async findRecentForStats(userId, limit = 5) {
    return Submission.find({ userId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
  }

  async findRecentlySolvedForStats(userId, limit = 5) {
    return Submission.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(String(userId)), verdict: "Accepted" } },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: "$questionId",
          solvedAt: { $first: "$createdAt" },
        },
      },
      { $sort: { solvedAt: -1, _id: -1 } },
      { $limit: limit },
    ]);
  }

  async getWeeklyStats(userId, since) {
    const normalizedUserId = new mongoose.Types.ObjectId(String(userId));
    const [summary] = await Submission.aggregate([
      { $match: { userId: normalizedUserId, createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          attemptedQuestionIds: { $addToSet: "$questionId" },
          solvedQuestionIds: {
            $addToSet: {
              $cond: [
                { $eq: ["$verdict", "Accepted"] },
                "$questionId",
                null,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          attemptedQuestionIds: 1,
          solvedQuestionIds: { $setDifference: ["$solvedQuestionIds", [null]] },
        },
      },
    ]);

    return summary || { attemptedQuestionIds: [], solvedQuestionIds: [] };
  }

  async findByUserId(userId) {
    return Submission.find({ userId }).sort({ createdAt: -1 }).lean();
  }

  async findUserQuestionSubmissions({ userId, questionId }) {
    return Submission.find({
      questionId,
      userId,
    });
  }

  async findByUserAndSubmissionId(userId, submissionId) {
    return Submission.findOne({
      _id: submissionId,
      userId,
    });
  }

  findCompletedContestCursor({
    contestId,
    userId = null,
    batchSize = 100,
    excludeSubmissionIds = [],
  }) {
    const criteria = {
      contestId,
      status: SUBMISSION_STATUS.COMPLETED,
    };
    if (userId) {
      criteria.userId = userId;
    }
    if (Array.isArray(excludeSubmissionIds) && excludeSubmissionIds.length > 0) {
      criteria._id = { $nin: excludeSubmissionIds };
    }
    return Submission.find(criteria)
      .sort({ userId: 1, contestProblemId: 1, submittedAtContestMs: 1, _id: 1 })
      .select("_id userId contestId contestProblemId verdict status submittedAtContestMs updatedAt")
      .lean()
      .cursor({ batchSize });
  }

  async getContestSourceFingerprint(
    contestId,
    userId = null,
    batchSize = 100,
    excludeSubmissionIds = [],
  ) {
    const criteria = {
      contestId,
      status: SUBMISSION_STATUS.COMPLETED,
    };
    if (userId) {
      criteria.userId = userId;
    }
    if (Array.isArray(excludeSubmissionIds) && excludeSubmissionIds.length > 0) {
      criteria._id = { $nin: excludeSubmissionIds };
    }
    const hash = crypto.createHash("sha256");
    const cursor = Submission.find(criteria)
      .sort({ _id: 1 })
      .select("_id userId contestId contestProblemId verdict status submittedAtContestMs updatedAt")
      .lean()
      .cursor({ batchSize });

    try {
      for await (const submission of cursor) {
        hash.update(
          JSON.stringify([
            String(submission._id),
            String(submission.userId),
            String(submission.contestId),
            String(submission.contestProblemId),
            submission.verdict,
            submission.status,
            submission.submittedAtContestMs,
            submission.updatedAt ? submission.updatedAt.toISOString() : null,
          ]),
        );
        hash.update("\n");
      }
    } finally {
      await cursor.close();
    }

    return hash.digest("hex");
  }
}

module.exports = new SubmissionRepository();
