const IoRedis = require("ioredis");
const { Queue } = require("bullmq");

const connection = new IoRedis({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
});

const queue = new Queue("js-queue", { connection });

module.exports = {
  connection,
  queue,
};
