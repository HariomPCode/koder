const { Contest, ContestParticipant, Submission } = require("@koder/shared");

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

  async findAll() {
    return Contest.find({}).sort({ startTime: -1 }).lean();
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

  async listParticipants(contestId) {
    return ContestParticipant.find({ contestId }).sort({ registeredAt: -1 }).lean();
  }

  async listSubmissions(contestId, userId = null) {
    const criteria = { contestId };
    if (userId) {
      criteria.userId = userId;
    }
    return Submission.find(criteria).sort({ createdAt: -1 }).lean();
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
}

module.exports = new ContestRepository();
