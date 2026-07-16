const IoRedis = require("ioredis");
const { Queue } = require("bullmq");

const connection = new IoRedis({
  host: "localhost",
  port: 6379,
  maxRetriesPerRequest: null, // essential for using bullmq
});

const queue = new Queue("js-queue", { connection });

module.exports = {
  connection,
  queue,
};
