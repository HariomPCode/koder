const Submission = require("../models/Submission");
const Question = require("../models/Question");
const { SUBMISSION_STATUS } = require("../contracts/verdicts");
const { createLogger } = require("../logger");
const logger = createLogger("shared.submission");
const eventBus = require("../events/eventBus");
const { applySubmissionResult } = require("../scoring/applySubmissionResult");
const {
  enqueueLeaderboardProjectionIfConfigured,
} = require("../leaderboard/projectionIntegration");

async function triggerContestScoring(
  submissionId,
  submissionDocument = null,
  { onProjectionFailure = null, applyScoring = applySubmissionResult } = {},
) {
  try {
    const scoringResult = await applyScoring(submissionId, { submission: submissionDocument });
    if (
      scoringResult?.projectionRequired &&
      submissionDocument?.contestId &&
      submissionDocument?.userId
    ) {
      const projectionResult = await enqueueLeaderboardProjectionIfConfigured({
        contestId: submissionDocument.contestId,
        userId: submissionDocument.userId,
      });
      if (!projectionResult.enqueued && projectionResult.reason === "enqueue_failed") {
        onProjectionFailure?.(projectionResult.error);
      }
    }
    return scoringResult;
  } catch (error) {
    logger.error({
      event: "contest_scoring_failed",
      submissionId: String(submissionId),
      err: error,
    });
  }
}

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
  const submission = await SubmissionModel.findOneAndUpdate(
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
  if (submission) {
    eventBus.emit("submission.running", {
      submissionId: String(submission._id),
      userId: String(submission.userId),
      contestId: submission.contestId ? String(submission.contestId) : null,
    });
  }
  return submission;
}

async function updateSubmission(
  submissionId,
  result,
  { SubmissionModel = Submission, onProjectionFailure = null } = {},
) {
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
        failureType: result.failureType || null,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!submission) {
    const existingSubmission = await SubmissionModel.findById(submissionId);
    if (
      existingSubmission &&
      existingSubmission.status === SUBMISSION_STATUS.COMPLETED &&
      existingSubmission.contestId
    ) {
      await triggerContestScoring(submissionId, existingSubmission, { onProjectionFailure });
      eventBus.emit("submission.completed", {
        submissionId: String(existingSubmission._id),
        userId: String(existingSubmission.userId),
        contestId: existingSubmission.contestId ? String(existingSubmission.contestId) : null,
        status: existingSubmission.status,
        verdict: existingSubmission.verdict,
        failureType: existingSubmission.failureType || null,
      });
    }
    return null;
  }

  if (submission.contestId) {
    await triggerContestScoring(submissionId, submission, { onProjectionFailure });
  }

  eventBus.emit("submission.completed", {
    submissionId: String(submission._id),
    userId: String(submission.userId),
    contestId: submission.contestId ? String(submission.contestId) : null,
    status: submission.status,
    verdict: submission.verdict,
    failureType: submission.failureType || null,
  });

  return submission;
}

module.exports = {
  triggerContestScoring,
  getQuestionDetails,
  markSubmissionRunning,
  updateSubmission,
};
