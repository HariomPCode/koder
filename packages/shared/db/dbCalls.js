const Submission = require("../models/Submission");
const Question = require("../models/Question");

async function getQuestionDetails(submissionId, { SubmissionModel = Submission, QuestionModel = Question } = {}) {
  const submission = await SubmissionModel.findById({ _id: submissionId });

  if (!submission) {
    throw new Error("Submission not found");
  }

  const question = await QuestionModel.findById({ _id: submission.questionId });

  if (!question) {
    throw new Error("Question not found");
  }

  return {
    language: submission.language,
    code: submission.code,
    testcases: [...(question.sampleTestCases || []), ...(question.hiddenTestCases || [])],
    slug: question.slug,
    functionName: question.functionName,
    parameters: question.parameters || [],
    returnType: question.returnType,
  };
}

async function updateSubmission(submissionId, result, { SubmissionModel = Submission } = {}) {
  const submission = await SubmissionModel.findByIdAndUpdate(
    { _id: submissionId },
    {
      status: result.status,
      verdict: result.verdict,
      passedTestCases: result.passed,
      totalTestCases: result.total,
      maxRuntime: result.maxRuntime,
      totalRuntime: result.totalRuntime,
      memory: result.memory,
      failedTestCase: result.failedTestCase,
      errorMessage: result.errorMessage,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!submission) {
    throw new Error("Submission not found");
  }

  return submission;
}

module.exports = {
  getQuestionDetails,
  updateSubmission,
};
