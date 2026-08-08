const IoRedis = require("ioredis");
const { Queue } = require("bullmq");

const connection = new IoRedis({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
});

const jsQueue = new Queue("js-queue", { connection });
const javaQueue = new Queue("java-queue", { connection });

module.exports = {
  connection,
  jsQueue,
  javaQueue,
};
