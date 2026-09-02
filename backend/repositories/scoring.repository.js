const {
  Submission,
  Contest,
  ContestParticipant,
  ContestParticipantProblem,
  ContestScoredSubmission,
  SUBMISSION_STATUS,
} = require("@koder/shared");

class ScoringRepository {
  async findSubmissionById(submissionId) {
    return Submission.findById(submissionId).lean();
  }

  async findContestById(contestId) {
    return Contest.findById(contestId).lean();
  }

  async findParticipant(contestId, userId) {
    return ContestParticipant.findOne({ contestId, userId }).lean();
  }

  async findProblemState(contestId, userId, contestProblemId) {
    return ContestParticipantProblem.findOne({ contestId, userId, contestProblemId }).lean();
  }

  async findParticipantAggregate(contestId, userId) {
    return ContestParticipant.findOne({ contestId, userId }).lean();
  }

  async findScopedCompletedSubmissions({ contestId, userId, contestProblemId }) {
    return Submission.find({
      contestId,
      userId,
      contestProblemId,
      status: SUBMISSION_STATUS.COMPLETED,
    }).lean();
  }

  async findLedgerEntry(submissionId) {
    return ContestScoredSubmission.findOne({ submissionId }).lean();
  }

  findParticipantsCursor(contestId, batchSize = 100) {
    return ContestParticipant.find({ contestId })
      .sort({ userId: 1 })
      .lean()
      .cursor({ batchSize });
  }

  findProblemStatesCursor({ contestId, userId = null, batchSize = 100 }) {
    const criteria = { contestId };
    if (userId) {
      criteria.userId = userId;
    }
    return ContestParticipantProblem.find(criteria)
      .sort({ userId: 1, contestProblemId: 1 })
      .lean()
      .cursor({ batchSize });
  }

  async findParticipantProblems(contestId, userId) {
    return ContestParticipantProblem.find({ contestId, userId }).lean();
  }

  async upsertProblemState({ contestId, userId, contestProblemId, state }) {
    return ContestParticipantProblem.updateOne(
      { contestId, userId, contestProblemId },
      { $set: state },
      { upsert: true, runValidators: true },
    );
  }

  async deleteProblemState(contestId, userId, contestProblemId) {
    return ContestParticipantProblem.deleteOne({ contestId, userId, contestProblemId });
  }

  async updateParticipantAggregate(contestId, userId, aggregate) {
    return ContestParticipant.updateOne(
      { contestId, userId },
      { $set: aggregate },
      { runValidators: true },
    );
  }

  async createLedgerEntry(data) {
    return ContestScoredSubmission.create(data);
  }

  async updateLedgerEffect(submissionId, effect) {
    return ContestScoredSubmission.updateOne({ submissionId }, { $set: { effect } });
  }

  async findContestSubmissionLedger(submissionId) {
    return ContestScoredSubmission.findOne({ submissionId }).lean();
  }

  async countContestParticipants(contestId) {
    return ContestParticipant.countDocuments({ contestId });
  }

  async findSubmissionIdentity(submissionId) {
    return Submission.findById(submissionId)
      .select("_id contestId userId contestProblemId verdict submittedAtContestMs")
      .lean();
  }
}

module.exports = new ScoringRepository();
