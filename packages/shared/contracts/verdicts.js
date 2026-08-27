/**
 * Canonical submission statuses and judge verdicts.
 */

const SUBMISSION_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
});

const JUDGE_VERDICTS = Object.freeze({
  ACCEPTED: "Accepted",
  WRONG_ANSWER: "Wrong Answer",
  COMPILATION_ERROR: "Compilation Error",
  RUNTIME_ERROR: "Runtime Error",
  TIME_LIMIT_EXCEEDED: "Time Limit Exceeded",
  MEMORY_LIMIT_EXCEEDED: "Memory Limit Exceeded",
});

module.exports = {
  SUBMISSION_STATUS,
  JUDGE_VERDICTS,
};
