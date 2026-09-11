const SubmissionRepository = require("../repositories/submission.repository");
const { createLogger } = require("@koder/shared");
const defaultLogger = createLogger("backend.submission_reconciliation");

const RECONCILIATION_INTERVAL_MS = 30 * 1000;
const STALE_SUBMISSION_AGE_MS = 10 * 1000;
const DEFAULT_BATCH_SIZE = 100;

function createReconciliationRunner({
  repository = SubmissionRepository,
  reconcileSubmission = null,
  staleAfterMs = STALE_SUBMISSION_AGE_MS,
  batchSize = DEFAULT_BATCH_SIZE,
  now = () => Date.now(),
  logger = defaultLogger,
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
        const enqueuePayload = {
          submissionId: submission._id,
          language: submission.language,
          userId: submission.userId,
          questionId: submission.questionId,
        };
        if (submission.contestId !== undefined) {
          enqueuePayload.contestId = submission.contestId;
        }
        await enqueue(enqueuePayload);
        result.recovered += 1;
      } catch (error) {
        result.failed += 1;
        logger.error({
          event: "submission_reconciliation_failed",
          submissionId: String(submission._id),
          err: error,
        });
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
      defaultLogger.error({ event: "submission_reconciliation_sweep_failed", err: error });
    });
  }, intervalMs);
  timer.unref?.();
  run().catch((error) => {
    defaultLogger.error({ event: "submission_startup_reconciliation_failed", err: error });
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
