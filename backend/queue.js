const IoRedis = require("ioredis");
const { Queue } = require("bullmq");
const { QUEUE_NAMES, getRedisConfig } = require("@koder/shared");

const connection = new IoRedis(getRedisConfig());

const jsQueue = new Queue(QUEUE_NAMES.javascript, { connection });
const javaQueue = new Queue(QUEUE_NAMES.java, { connection });
const pythonQueue = new Queue(QUEUE_NAMES.python, { connection });

module.exports = {
  connection,
  jsQueue,
  javaQueue,
  pythonQueue,
};

