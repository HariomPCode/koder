const { Submission, SUBMISSION_STATUS } = require("@koder/shared");
const crypto = require("crypto");

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

  findCompletedContestCursor({ contestId, userId = null, batchSize = 100 }) {
    const criteria = {
      contestId,
      status: SUBMISSION_STATUS.COMPLETED,
    };
    if (userId) {
      criteria.userId = userId;
    }
    return Submission.find(criteria)
      .sort({ userId: 1, contestProblemId: 1, submittedAtContestMs: 1, _id: 1 })
      .select("_id userId contestId contestProblemId verdict status submittedAtContestMs updatedAt")
      .lean()
      .cursor({ batchSize });
  }

  async getContestSourceFingerprint(contestId, userId = null, batchSize = 100) {
    const criteria = {
      contestId,
      status: SUBMISSION_STATUS.COMPLETED,
    };
    if (userId) {
      criteria.userId = userId;
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
