const mongoose = require("mongoose");

const testCaseSchema = new mongoose.Schema(
  {
    input: {
      type: String,
      required: true,
    },
    output: {
      type: String,
      required: true,
    },
  },
  { _id: false },
);

const questionSchema = new mongoose.Schema(
  {
    questionNum: {
      type: Number,
      required: true,
      unique: true,
    },

    title: {
      type: String,
      required: true,
    },

    slug: {
      // route name
      type: String,
      required: true,
      unique: true,
    },

    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      required: true,
    },

    description: {
      type: String,
      required: true,
    },

    constraints: [String],

    sampleTestCases: [testCaseSchema],

    hiddenTestCases: [testCaseSchema],

    tags: [String],
  },
  {
    timestamps: true,
  },
);

const Question = mongoose.model("Question", questionSchema);

module.exports = Question;
