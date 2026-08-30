const mongoose = require("mongoose");

const contestProblemSchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
    },
    order: {
      type: Number,
      required: true,
      min: 1,
    },
    points: {
      type: Number,
      required: true,
      min: 0,
    },
    penaltyMinutes: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { timestamps: true },
);

const contestSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    registrationOpenTime: {
      type: Date,
      required: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["DRAFT", "SCHEDULED", "REGISTRATION", "RUNNING", "ENDED", "FINALIZED"],
      default: "DRAFT",
    },
    problems: {
      type: [contestProblemSchema],
      required: true,
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

contestSchema.index({ status: 1, startTime: 1 });

contestSchema.pre("validate", function validateContestTimes() {
  if (this.startTime && this.endTime && this.endTime <= this.startTime) {
    this.invalidate("endTime", "endTime must be greater than startTime");
  }

  if (
    this.registrationOpenTime &&
    this.startTime &&
    this.registrationOpenTime > this.startTime
  ) {
    this.invalidate(
      "registrationOpenTime",
      "registrationOpenTime must be less than or equal to startTime",
    );
  }
});

const Contest = mongoose.models.Contest || mongoose.model("Contest", contestSchema);

module.exports = Contest;
