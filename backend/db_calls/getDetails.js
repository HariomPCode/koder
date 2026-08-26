const Submission = require("../models/Submission");
const Question = require("../models/Question");

async function getQuestionDetails(submissionId) {
  const submission = await Submission.findById({ _id: submissionId });

  if (!submission) {
    throw new Error("Submission not found");
  }

  const question = await Question.findById({ _id: submission.questionId });

  if (!question) {
    throw new Error("Question not found");
  }

  return {
    language: submission.language,
    code: submission.code,
    testcases: [...question.sampleTestCases, ...question.hiddenTestCases],
    slug: question.slug,
    functionName: question.functionName,
    parameters: question.parameters || [],
    returnType: question.returnType,
  };
}

module.exports = { getQuestionDetails };
