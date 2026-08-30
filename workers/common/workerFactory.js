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
} = require("@koder/shared");
const {
  reserveExecutionSlot,
  releaseExecutionSlot,
} = require("./hostCapacity");
const cleanupOrphanContainers = require("./orphanContainerCleanup");
const connectDB = require("./db");

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
          console.log(`Skipping RUNNING update for terminal submission ${submissionId}`);
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
  await cleanupOrphanContainers().catch((error) => {
    console.warn(`Orphan cleanup skipped for ${queueName}:`, error?.message || error);
  });

  console.log(`Worker connected to MongoDB`);

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
    console.log(`Worker ${queueName} accepted job ${job?.id} (${job?.data?.submissionId || "n/a"})`);
  });

  worker.on("completed", (job, result) => {
    console.log(`Worker ${queueName} completed job ${job?.id} for submission ${job?.data?.submissionId || "n/a"}`);
    if (result && result.status === "already-completed") {
      console.log(`Job ${job?.id} was skipped because the submission was already terminal.`);
    }
  });

  worker.on("failed", async (job, err) => {
    console.error(`Job ${job?.id} failed with error:`, err?.message || err);
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
        });
      } catch (dbErr) {
        console.error("Failed to update submission on job failure:", dbErr);
      }
    }
  });

  worker.on("error", (err) => {
    console.error(`Worker error on ${queueName}:`, err);
  });

  const shutdown = async (signal) => {
    try {
      console.log(`Shutting down ${queueName} worker on ${signal}...`);
      await worker.close(true);
      await connection.quit();
      process.exit(0);
    } catch (error) {
      console.error(`Error during ${queueName} shutdown:`, error);
      process.exit(1);
    }
  };

  process.once("SIGTERM", () => {
    shutdown("SIGTERM").catch((error) => {
      console.error("SIGTERM shutdown failed:", error);
      process.exit(1);
    });
  });

  process.once("SIGINT", () => {
    shutdown("SIGINT").catch((error) => {
      console.error("SIGINT shutdown failed:", error);
      process.exit(1);
    });
  });

  console.log(`Worker listening on ${queueName} with concurrency=${capacityConfig.effectiveConcurrency}; host budget=${capacityConfig.hostMaxActiveJobs}`);

  return worker;
}

module.exports = createWorker;
