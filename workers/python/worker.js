const createWorker = require("../common/workerFactory");
const executor = require("./executor");

createWorker("python-queue", async (job) => {
  return await executor(job);
});
