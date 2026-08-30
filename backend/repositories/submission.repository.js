const { Submission } = require("@koder/shared");

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
}

module.exports = new SubmissionRepository();
