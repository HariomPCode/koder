const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});

const { Worker } = require("bullmq");
const IoRedis = require("ioredis");
const {
  getRedisConfig,
  updateSubmission,
  markSubmissionRunning,
  QUEUE_STALL_DEFAULTS,
  getWorkerConcurrencyConfig,
  getOrphanCleanupConfig,
  createLogger,
} = require("@koder/shared");
const {
  reserveExecutionSlot,
  releaseExecutionSlot,
} = require("./hostCapacity");
const cleanupOrphanContainers = require("./orphanContainerCleanup");
const startPeriodicOrphanCleanup = require("./periodicOrphanCleanup");
const connectDB = require("./db");
const {
  enqueueLeaderboardProjection,
  closeLeaderboardProjectionProducer,
} = require("../leaderboard/producer");
const { setLeaderboardProjectionEnqueuer } = require("@koder/shared");

setLeaderboardProjectionEnqueuer(enqueueLeaderboardProjection);
const logger = createLogger("worker.execution");

function createCapacityGuard(queueName, wrappedProcessor) {
  return async function guardedProcessor(job) {
    const { submissionId } = job.data || {};
    const capacityConfig = getWorkerConcurrencyConfig(queueName);

    const reserved = await reserveExecutionSlot({
      limit: capacityConfig.hostMaxActiveJobs,
    });

    if (!reserved.acquired) {
      const error = new Error("Host execution capacity reached");
      error.code = "HOST_CAPACITY_EXCEEDED";
      throw error;
    }

    try {
      if (submissionId) {
        const runningDocument = await markSubmissionRunning(submissionId);
        if (!runningDocument) {
          logger.info({
            event: "submission_running_update_skipped",
            submissionId: String(submissionId),
          });
        }
      }

      return await wrappedProcessor(job);
    } finally {
      await releaseExecutionSlot();
    }
  };
}

async function createWorker(queueName, processor) {
  await connectDB();
  const activeJobIds = new Set();
  const orphanCleanupConfig = getOrphanCleanupConfig();
  await cleanupOrphanContainers({
    activeJobIds,
    maxAgeMs: orphanCleanupConfig.maxAgeMs,
  }).catch((error) => {
    logger.warn({ event: "orphan_cleanup_startup_skipped", queue: queueName, err: error });
  });
  const orphanCleanupTimer = startPeriodicOrphanCleanup({
    activeJobIds,
    intervalMs: orphanCleanupConfig.intervalMs,
    maxAgeMs: orphanCleanupConfig.maxAgeMs,
    onError: (error) => {
      logger.warn({ event: "periodic_orphan_cleanup_failed", err: error });
    },
  });

  logger.info({ event: "worker_mongodb_ready", queue: queueName });

  const connection = new IoRedis(getRedisConfig());
  const capacityConfig = getWorkerConcurrencyConfig(queueName);
  const guardedProcessor = createCapacityGuard(queueName, processor);

  const worker = new Worker(queueName, guardedProcessor, {
    connection,
    concurrency: capacityConfig.concurrency,
    stalledInterval: QUEUE_STALL_DEFAULTS.stalledInterval,
    maxStalledCount: QUEUE_STALL_DEFAULTS.maxStalledCount,
    lockDuration: QUEUE_STALL_DEFAULTS.lockDuration,
  });

  worker.on("active", (job) => {
    activeJobIds.add(String(job?.id));
  });
  worker.on("completed", (job) => {
    activeJobIds.delete(String(job?.id));
  });
  worker.on("failed", (job) => {
    activeJobIds.delete(String(job?.id));
  });

  worker.on("active", (job) => {
    logger.info({
      event: "job_started",
      queue: queueName,
      jobId: String(job?.id || ""),
      submissionId: job?.data?.submissionId ? String(job.data.submissionId) : undefined,
      attempt: job?.attemptsMade ?? 0,
    });
  });

  worker.on("completed", (job, result) => {
    logger.info({
      event: "job_completed",
      queue: queueName,
      jobId: String(job?.id || ""),
      submissionId: job?.data?.submissionId ? String(job.data.submissionId) : undefined,
      attempt: job?.attemptsMade ?? 0,
    });
    if (result && result.status === "already-completed") {
      logger.info({
        event: "job_skipped_terminal_submission",
        queue: queueName,
        jobId: String(job?.id || ""),
        submissionId: job?.data?.submissionId ? String(job.data.submissionId) : undefined,
      });
    }
  });

  worker.on("failed", async (job, err) => {
    logger.error({
      event: "job_failed",
      queue: queueName,
      jobId: String(job?.id || ""),
      submissionId: job?.data?.submissionId ? String(job.data.submissionId) : undefined,
      attempt: job?.attemptsMade ?? 0,
      err,
    });
    if (job?.data?.submissionId) {
      try {
        const isTLE =
          err?.code === "TLE" || err?.message === "Time Limit Exceeded";
        await updateSubmission(job.data.submissionId, {
          status: "completed",
          verdict: isTLE ? "Time Limit Exceeded" : "Runtime Error",
          passed: 0,
          total: 0,
          totalRuntime: 0,
          maxRuntime: 0,
          memory: 0,
          failedTestCase: null,
          errorMessage: err?.message || "Execution failed",
        }, {
          onProjectionFailure: (projectionError) => {
            logger.error({
              event: "leaderboard_projection_enqueue_failed",
              submissionId: String(job.data.submissionId),
              err: projectionError,
            });
          },
        });
      } catch (dbErr) {
        logger.error({
          event: "submission_failure_update_failed",
          submissionId: String(job.data.submissionId),
          err: dbErr,
        });
      }
    }
  });

  worker.on("error", (err) => {
    logger.error({ event: "worker_error", queue: queueName, err });
  });

  const shutdown = async (signal) => {
    try {
      logger.info({ event: "worker_shutdown_started", queue: queueName, signal });
      await orphanCleanupTimer.stop();
      await worker.close();
      await closeLeaderboardProjectionProducer();
      await connection.quit();
      process.exit(0);
    } catch (error) {
      logger.error({ event: "worker_shutdown_failed", queue: queueName, signal, err: error });
      process.exit(1);
    }
  };

  process.once("SIGTERM", () => {
    shutdown("SIGTERM").catch((error) => {
      logger.error({ event: "sigterm_shutdown_failed", queue: queueName, err: error });
      process.exit(1);
    });
  });

  process.once("SIGINT", () => {
    shutdown("SIGINT").catch((error) => {
      logger.error({ event: "sigint_shutdown_failed", queue: queueName, err: error });
      process.exit(1);
    });
  });

  logger.info({
    event: "worker_listening",
    queue: queueName,
    concurrency: capacityConfig.effectiveConcurrency,
    hostMaxActiveJobs: capacityConfig.hostMaxActiveJobs,
  });

  return worker;
}

module.exports = createWorker;
