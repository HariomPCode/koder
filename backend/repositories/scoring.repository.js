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
}

module.exports = new ScoringRepository();
