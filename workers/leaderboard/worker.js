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
} = require("@koder/shared");
const connectDB = require("../common/db");
const { createProjectionProcessor } = require("./projectionProcessor");

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
    console.log(`Leaderboard projection job started: ${job.id}`);
  });
  worker.on("completed", (job, result) => {
    console.log(`Leaderboard projection job completed: ${job.id}`, result);
  });
  worker.on("failed", (job, error) => {
    console.error(
      `Leaderboard projection job failed: ${job?.id || "unknown"} attempt=${job?.attemptsMade || 0}:`,
      error?.message || error,
    );
  });
  worker.on("error", (error) => {
    console.error("Leaderboard projection worker error:", error);
  });

  const shutdown = async (signal) => {
    try {
      console.log(`Shutting down leaderboard projection worker on ${signal}...`);
      await worker.close(true);
      await connection.quit();
      process.exit(0);
    } catch (error) {
      console.error("Leaderboard projection worker shutdown failed:", error);
      process.exit(1);
    }
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  console.log(
    `Worker listening on ${LEADERBOARD_PROJECTION_QUEUE_NAME} for ${LEADERBOARD_PROJECTION_JOB_NAME}`,
  );
  return worker;
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Failed to start leaderboard projection worker:", error);
    process.exit(1);
  });
}

module.exports = { start };
