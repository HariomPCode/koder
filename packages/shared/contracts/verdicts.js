/**
 * Canonical submission statuses and judge verdicts.
 *
 * NOTE:
 * - The production lifecycle is CREATED -> QUEUED -> RUNNING -> COMPLETED.
 * - PENDING is retained as a legacy compatibility alias for historical records and
 *   older code paths until the broader worker and API state machine is fully migrated.
 */

const SUBMISSION_STATUS = Object.freeze({
  CREATED: "created",
  QUEUED: "queued",
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
