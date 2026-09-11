const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

const { Worker } = require("bullmq");
const IoRedis = require("ioredis");
const {
  LEADERBOARD_PROJECTION_QUEUE_NAME,
  LEADERBOARD_PROJECTION_JOB_NAME,
  QUEUE_STALL_DEFAULTS,
  createQueueJobOptions,
  getRedisConfig,
  createLogger,
} = require("@koder/shared");
const connectDB = require("../common/db");
const { createProjectionProcessor } = require("./projectionProcessor");
const logger = createLogger("worker.leaderboard");

async function start() {
  await connectDB();
  const connection = new IoRedis(getRedisConfig());
  const processor = createProjectionProcessor({ redis: connection });
  const worker = new Worker(LEADERBOARD_PROJECTION_QUEUE_NAME, processor, {
    connection,
    ...createQueueJobOptions(),
    stalledInterval: QUEUE_STALL_DEFAULTS.stalledInterval,
    maxStalledCount: QUEUE_STALL_DEFAULTS.maxStalledCount,
    lockDuration: QUEUE_STALL_DEFAULTS.lockDuration,
  });

  worker.on("active", (job) => {
    logger.info({ event: "leaderboard_job_started", jobId: String(job.id), attempt: job.attemptsMade ?? 0 });
  });
  worker.on("completed", (job, result) => {
    logger.info({ event: "leaderboard_job_completed", jobId: String(job.id), result });
  });
  worker.on("failed", (job, error) => {
    logger.error({
      event: "leaderboard_job_failed",
      jobId: String(job?.id || "unknown"),
      attempt: job?.attemptsMade ?? 0,
      err: error,
    });
  });
  worker.on("error", (error) => {
    logger.error({ event: "leaderboard_worker_error", err: error });
  });

  const shutdown = async (signal) => {
    try {
      logger.info({ event: "leaderboard_worker_shutdown_started", signal });
      await worker.close(true);
      await connection.quit();
      process.exit(0);
    } catch (error) {
      logger.error({ event: "leaderboard_worker_shutdown_failed", signal, err: error });
      process.exit(1);
    }
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  logger.info({
    event: "leaderboard_worker_listening",
    queue: LEADERBOARD_PROJECTION_QUEUE_NAME,
    jobName: LEADERBOARD_PROJECTION_JOB_NAME,
  });
  return worker;
}

if (require.main === module) {
  start().catch((error) => {
    logger.error({ event: "leaderboard_worker_start_failed", err: error });
    process.exit(1);
  });
}

module.exports = { start };
