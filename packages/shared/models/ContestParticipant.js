const mongoose = require("mongoose");

const contestParticipantSchema = new mongoose.Schema(
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
    registeredAt: {
      type: Date,
      default: Date.now,
    },
    solvedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPenalty: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastAcceptedContestMs: {
      type: Number,
      default: null,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

contestParticipantSchema.index({ contestId: 1, userId: 1 }, { unique: true });
contestParticipantSchema.index({ userId: 1 });
contestParticipantSchema.index({
  contestId: 1,
  solvedCount: -1,
  totalPenalty: 1,
  lastAcceptedContestMs: 1,
  userId: 1,
});

const ContestParticipant =
  mongoose.models.ContestParticipant ||
  mongoose.model("ContestParticipant", contestParticipantSchema);

module.exports = ContestParticipant;
