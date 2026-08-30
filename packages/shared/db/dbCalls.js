const Submission = require("../models/Submission");
const Question = require("../models/Question");
const { SUBMISSION_STATUS } = require("../contracts/verdicts");

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

async function markSubmissionRunning(submissionId, { SubmissionModel = Submission } = {}) {
  return SubmissionModel.findOneAndUpdate(
    {
      _id: submissionId,
      status: { $ne: SUBMISSION_STATUS.COMPLETED },
    },
    {
      $set: { status: SUBMISSION_STATUS.RUNNING },
    },
    {
      new: true,
      runValidators: true,
    },
  );
}

async function updateSubmission(submissionId, result, { SubmissionModel = Submission } = {}) {
  const terminalStatus = result.status || SUBMISSION_STATUS.COMPLETED;
  const submission = await SubmissionModel.findOneAndUpdate(
    {
      _id: submissionId,
      status: { $ne: SUBMISSION_STATUS.COMPLETED },
    },
    {
      $set: {
        status: terminalStatus,
        verdict: result.verdict,
        passedTestCases: result.passed,
        totalTestCases: result.total,
        maxRuntime: result.maxRuntime,
        totalRuntime: result.totalRuntime,
        memory: result.memory,
        failedTestCase: result.failedTestCase,
        errorMessage: result.errorMessage,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!submission) {
    return null;
  }

  return submission;
}

module.exports = {
  getQuestionDetails,
  markSubmissionRunning,
  updateSubmission,
};
