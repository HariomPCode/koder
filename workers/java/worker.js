const createWorker = require("../common/workerFactory");
const executor = require("./executor");

createWorker("java-queue", async (job) => {
  return await executor(job);
});
