const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../backend/.env"),
});

const connectDB = require("../../backend/db");
const { Worker } = require("bullmq");
const { connection } = require("../../backend/queue");

const updateSubmission = require("../../backend/db_calls/updateSubmission");

async function createWorker(queueName, processor) {
  await connectDB();

  console.log(`Worker connected to MongoDB`);

  const worker = new Worker(queueName, processor, {
    connection,
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

  console.log(`Worker listening on ${queueName}`);

  return worker;
}

module.exports = createWorker;
