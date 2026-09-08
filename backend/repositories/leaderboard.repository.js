const { ContestParticipant } = require("@koder/shared");

class LeaderboardRepository {
  constructor({ participantModel = ContestParticipant } = {}) {
    this.participantModel = participantModel;
  }

  countParticipants(contestId) {
    return this.participantModel.countDocuments({ contestId });
  }

  cursorParticipants(contestId) {
    return this.participantModel
      .find({ contestId })
      .sort({ userId: 1 })
      .select({
        userId: 1,
        solvedCount: 1,
        totalPenalty: 1,
        lastAcceptedContestMs: 1,
        updatedAt: 1,
      })
      .lean()
      .cursor();
  }
}

module.exports = LeaderboardRepository;
