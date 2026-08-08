const createWorker = require("../common/workerFactory");
const executor = require("./executor");

createWorker("js-queue", async (job) => {
  return await executor(job);
});
