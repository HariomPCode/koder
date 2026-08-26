const { jsQueue } = require("./queue");

async function inspectJob(jobId) {
  const job = await jsQueue.getJob(jobId);

  if (!job) {
    console.log(`Job ${jobId} not found`);
    return;
  }

  console.log(`\n========== JOB ${jobId} ==========`);

  console.log("State:", await job.getState());
  console.log("Name:", job.name);
  console.log("Data:", job.data);

  console.log("Attempts made:", job.attemptsMade);
  console.log("Attempts configured:", job.opts.attempts);

  console.log("Failed reason:", job.failedReason);

  console.log("\nStacktrace:");
  console.log(job.stacktrace);

  console.log("\nProcessed on:", job.processedOn);
  console.log("Finished on:", job.finishedOn);

  if (job.processedOn && job.finishedOn) {
    console.log("Duration:", job.finishedOn - job.processedOn, "ms");
  }

  console.log("\nReturn value:");
  console.dir(job.returnvalue, { depth: null });

  console.log("\nFull job:");
  console.dir(job.toJSON(), { depth: null });
}

async function main() {
  await inspectJob("9");
  await inspectJob("8");

  await jsQueue.close();
}

main().catch(console.error);
