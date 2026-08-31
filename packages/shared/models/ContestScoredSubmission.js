const mongoose = require("mongoose");
const { JUDGE_VERDICTS } = require("../contracts/verdicts");
const { SCORING_EFFECT } = require("../contracts/scoring");

const contestScoredSubmissionSchema = new mongoose.Schema(
  {
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      required: true,
    },
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
    verdict: {
      type: String,
      enum: Object.values(JUDGE_VERDICTS),
      required: true,
    },
    submittedAtContestMs: {
      type: Number,
      required: true,
      min: 0,
    },
    scoredAt: {
      type: Date,
      default: Date.now,
    },
    effect: {
      type: String,
      enum: Object.values(SCORING_EFFECT),
      default: SCORING_EFFECT.NONE,
    },
  },
  {
    timestamps: true,
  },
);

contestScoredSubmissionSchema.index({ submissionId: 1 }, { unique: true });
contestScoredSubmissionSchema.index({ contestId: 1, userId: 1 });

const ContestScoredSubmission =
  mongoose.models.ContestScoredSubmission ||
  mongoose.model("ContestScoredSubmission", contestScoredSubmissionSchema);

module.exports = ContestScoredSubmission;
