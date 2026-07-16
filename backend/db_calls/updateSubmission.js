const Submission = require("../models/Submission");

async function updateSubmission(submissionId, result) {
  const submission = await Submission.findByIdAndUpdate(
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

module.exports = updateSubmission;
