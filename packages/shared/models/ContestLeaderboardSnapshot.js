const mongoose = require("mongoose");

const standingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rank: {
      type: Number,
      required: true,
      min: 1,
    },
    solvedCount: {
      type: Number,
      required: true,
      min: 0,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
    },
    penalty: {
      type: Number,
      required: true,
      min: 0,
    },
    lastAcceptedAt: {
      type: Date,
    },
  },
  { _id: false },
);

const contestLeaderboardSnapshotSchema = new mongoose.Schema(
  {
    contestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contest",
      required: true,
    },
    takenAt: {
      type: Date,
      required: true,
    },
    isFinal: {
      type: Boolean,
      default: false,
    },
    standings: {
      type: [standingSchema],
      required: true,
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

contestLeaderboardSnapshotSchema.index({ contestId: 1, isFinal: 1 });
contestLeaderboardSnapshotSchema.index({ contestId: 1, takenAt: -1 });

const ContestLeaderboardSnapshot =
  mongoose.models.ContestLeaderboardSnapshot ||
  mongoose.model("ContestLeaderboardSnapshot", contestLeaderboardSnapshotSchema);

module.exports = ContestLeaderboardSnapshot;
