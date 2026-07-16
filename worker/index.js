require("dotenv").config({
  path: "../backend/.env",
});
const connectDB = require("../backend/db");
const { Worker } = require("bullmq");
const { connection } = require("../backend/queue");
const runSubmission = require("./executor/runSubmission");

(async () => {
  await connectDB();

  console.log("Worker connected to MongoDB");

  new Worker(
    "js-queue",
    async (job) => {
      return await runSubmission(job);
    },
    {
      connection,
    },
  );
})();
