const SubmissionRepository = require("../repositories/submission.repository");

const RECONCILIATION_INTERVAL_MS = 30 * 1000;
const STALE_SUBMISSION_AGE_MS = 10 * 1000;
const DEFAULT_BATCH_SIZE = 100;

function createReconciliationRunner({
  repository = SubmissionRepository,
  reconcileSubmission = null,
  staleAfterMs = STALE_SUBMISSION_AGE_MS,
  batchSize = DEFAULT_BATCH_SIZE,
  now = () => Date.now(),
  logger = console,
} = {}) {
  if (!repository || typeof repository.findStaleCreatedSubmissions !== "function") {
    throw new TypeError("repository.findStaleCreatedSubmissions is required");
  }
  const enqueue = reconcileSubmission || require("../queue").ensureSubmissionEnqueued;
  if (typeof enqueue !== "function") {
    throw new TypeError("reconcileSubmission is required");
  }

  return async function runReconciliation() {
    const cutoff = new Date(now() - staleAfterMs);
    const submissions = await repository.findStaleCreatedSubmissions({
      cutoff,
      limit: batchSize,
    });
    const result = {
      scanned: submissions.length,
      recovered: 0,
      failed: 0,
    };

    for (const submission of submissions) {
      try {
        await enqueue({
          submissionId: submission._id,
          language: submission.language,
          userId: submission.userId,
          questionId: submission.questionId,
        });
        result.recovered += 1;
      } catch (error) {
        result.failed += 1;
        logger.error(
          `Submission reconciliation failed for ${submission._id}:`,
          error?.message || error,
        );
      }
    }

    return result;
  };
}

function startSubmissionReconciliation({
  intervalMs = RECONCILIATION_INTERVAL_MS,
  runner = null,
} = {}) {
  const run = runner || createReconciliationRunner();
  const timer = setInterval(() => {
    run().catch((error) => {
      console.error("Submission reconciliation failed:", error?.message || error);
    });
  }, intervalMs);
  timer.unref?.();
  run().catch((error) => {
    console.error("Submission startup reconciliation failed:", error?.message || error);
  });

  return {
    timer,
    async stop() {
      clearInterval(timer);
    },
  };
}

module.exports = {
  RECONCILIATION_INTERVAL_MS,
  STALE_SUBMISSION_AGE_MS,
  DEFAULT_BATCH_SIZE,
  createReconciliationRunner,
  startSubmissionReconciliation,
};
