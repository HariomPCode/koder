const {
  Contest,
  ContestParticipant,
  Submission,
  ContestLeaderboardSnapshot,
  ContestFinalizationAudit,
} = require("@koder/shared");

class ContestRepository {
  async create(data) {
    return Contest.create(data);
  }

  async findById(contestId) {
    return Contest.findById(contestId);
  }

  async findBySlug(slug) {
    return Contest.findOne({ slug });
  }

  async findAll({ skip = 0, limit = 20 } = {}) {
    return Contest.find({})
      .sort({ startTime: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  }

  async countAll() {
    return Contest.countDocuments({});
  }

  async findByIdAndUpdate(contestId, data, options = {}) {
    return Contest.findByIdAndUpdate(contestId, data, {
      new: true,
      runValidators: true,
      ...options,
    });
  }

  async findParticipant(contestId, userId) {
    return ContestParticipant.findOne({ contestId, userId });
  }

  async createParticipant(data) {
    return ContestParticipant.create(data);
  }

  async deleteParticipant(contestId, userId) {
    return ContestParticipant.deleteOne({ contestId, userId });
  }

  async listParticipants(contestId, { skip = 0, limit = 50 } = {}) {
    return ContestParticipant.find({ contestId })
      .sort({ registeredAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  }

  async countParticipantsForList(contestId) {
    return ContestParticipant.countDocuments({ contestId });
  }

  async countParticipants(contestId) {
    return ContestParticipant.countDocuments({ contestId });
  }

  async findParticipantsPaginated(contestId, { skip = 0, limit = 50 } = {}) {
    return ContestParticipant.find({ contestId })
      .sort({
        solvedCount: -1,
        totalPenalty: 1,
        lastAcceptedContestMs: 1,
        userId: 1,
      })
      .skip(skip)
      .limit(limit)
      .lean();
  }

  async findParticipantAtOffset(contestId, offset) {
    if (offset < 0) {
      return null;
    }
    return ContestParticipant.findOne({ contestId })
      .sort({
        solvedCount: -1,
        totalPenalty: 1,
        lastAcceptedContestMs: 1,
        userId: 1,
      })
      .skip(offset)
      .lean();
  }

  async countParticipantsAhead(contestId, participant) {
    const pSolved = participant.solvedCount || 0;
    const pPenalty = participant.totalPenalty || 0;
    const pLastMs = participant.lastAcceptedContestMs ?? null;
    const pUserId = participant.userId;

    const aheadFilter = {
      contestId,
      $or: [
        { solvedCount: { $gt: pSolved } },
        {
          solvedCount: pSolved,
          totalPenalty: { $lt: pPenalty },
        },
        {
          solvedCount: pSolved,
          totalPenalty: pPenalty,
          ...(pLastMs != null
            ? { lastAcceptedContestMs: { $lt: pLastMs } }
            : { lastAcceptedContestMs: { $ne: null } }),
        },
        {
          solvedCount: pSolved,
          totalPenalty: pPenalty,
          lastAcceptedContestMs: pLastMs,
          userId: { $lt: pUserId },
        },
      ],
    };
    return ContestParticipant.countDocuments(aheadFilter);
  }

  async listSubmissions(contestId, userId = null, { skip = 0, limit = 50 } = {}) {
    const criteria = { contestId };
    if (userId) {
      criteria.userId = userId;
    }
    return Submission.find(criteria)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  }

  async countSubmissions(contestId, userId = null) {
    const criteria = { contestId };
    if (userId) {
      criteria.userId = userId;
    }
    return Submission.countDocuments(criteria);
  }

  async createSubmission(data) {
    return Submission.create(data);
  }

  async getContestProblem(contest, contestProblemId) {
    if (!contest || !Array.isArray(contest.problems)) {
      return null;
    }

    return contest.problems.find((problem) => String(problem._id) === String(contestProblemId)) || null;
  }

  async findFinalSnapshot(contestId) {
    return ContestLeaderboardSnapshot.findOne({ contestId, isFinal: true }).lean();
  }

  async findFinalizationAudit(contestId) {
    return ContestFinalizationAudit.findOne({ contestId, forced: true }).lean();
  }

  async createFinalizationAudit(data) {
    return ContestFinalizationAudit.create(data);
  }
}

module.exports = new ContestRepository();
