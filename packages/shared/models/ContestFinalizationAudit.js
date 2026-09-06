const mongoose = require("mongoose");

const contestFinalizationAuditSchema = new mongoose.Schema(
  {
    contestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contest",
      required: true,
      index: true,
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    forced: {
      type: Boolean,
      required: true,
      default: false,
    },
    finalizedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    pendingSubmissionCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    pendingSubmissionIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Submission",
        },
      ],
      default: [],
    },
    reason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

contestFinalizationAuditSchema.index({ contestId: 1, finalizedAt: -1 });
contestFinalizationAuditSchema.index({ contestId: 1, pendingSubmissionIds: 1 });

const ContestFinalizationAudit =
  mongoose.models.ContestFinalizationAudit ||
  mongoose.model("ContestFinalizationAudit", contestFinalizationAuditSchema);

module.exports = ContestFinalizationAudit;
