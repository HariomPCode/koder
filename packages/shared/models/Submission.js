const mongoose = require("mongoose");
const { SUPPORTED_LANGUAGES } = require("../config/languages");
const { SUBMISSION_STATUS, JUDGE_VERDICTS } = require("../contracts/verdicts");

const submissionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
    },

    contestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contest",
      default: null,
    },

    contestProblemId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    submittedAtContestMs: {
      type: Number,
      default: null,
    },

    code: {
      type: String,
      required: true,
    },

    language: {
      type: String,
      enum: SUPPORTED_LANGUAGES,
      required: true,
    },

    status: {
      type: String,
      enum: Object.values(SUBMISSION_STATUS),
      default: SUBMISSION_STATUS.CREATED,
    },

    verdict: {
      type: String,
      enum: Object.values(JUDGE_VERDICTS),
    },

    passedTestCases: {
      type: Number,
      default: 0,
    },

    totalTestCases: {
      type: Number,
      default: 0,
    },

    totalRuntime: {
      type: Number,
      default: 0,
    },

    maxRuntime: {
      type: Number,
      default: 0,
    },

    memory: {
      type: Number,
      default: 0,
    },

    failedTestCase: {
      input: String,
      expected: String,
      received: String,
    },

    errorMessage: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

submissionSchema.index({ userId: 1, createdAt: -1 });
submissionSchema.index({ userId: 1, questionId: 1 });
submissionSchema.index({ contestId: 1, userId: 1, contestProblemId: 1, verdict: 1 });
submissionSchema.index({ contestId: 1, status: 1 });
submissionSchema.index({ status: 1, createdAt: 1 });

const Submission = mongoose.models.Submission || mongoose.model("Submission", submissionSchema);

module.exports = Submission;
