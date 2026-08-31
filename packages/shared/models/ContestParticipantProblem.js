const mongoose = require("mongoose");

const contestParticipantProblemSchema = new mongoose.Schema(
  {
    contestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contest",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    contestProblemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    solved: {
      type: Boolean,
      default: false,
    },
    firstAcceptedSubmissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      default: null,
    },
    firstAcceptedAtContestMs: {
      type: Number,
      default: null,
      min: 0,
    },
    problemPenalty: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

contestParticipantProblemSchema.index(
  { contestId: 1, userId: 1, contestProblemId: 1 },
  { unique: true },
);

contestParticipantProblemSchema.pre("validate", function validateSolvedState() {
  if (this.solved) {
    if (!this.firstAcceptedSubmissionId) {
      this.invalidate(
        "firstAcceptedSubmissionId",
        "firstAcceptedSubmissionId is required when solved is true",
      );
    }
    if (this.firstAcceptedAtContestMs == null) {
      this.invalidate(
        "firstAcceptedAtContestMs",
        "firstAcceptedAtContestMs is required when solved is true",
      );
    }
  } else if (this.problemPenalty > 0) {
    this.invalidate("problemPenalty", "problemPenalty must be 0 when solved is false");
  }
});

const ContestParticipantProblem =
  mongoose.models.ContestParticipantProblem ||
  mongoose.model("ContestParticipantProblem", contestParticipantProblemSchema);

module.exports = ContestParticipantProblem;
