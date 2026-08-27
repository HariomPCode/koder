/**
 * Pure queue names, job names, and Redis connection configuration constants.
 * Does NOT instantiate any live connection or Queue instances.
 */

const QUEUE_NAMES = Object.freeze({
  javascript: "js-queue",
  java: "java-queue",
});

const JOB_NAMES = Object.freeze({
  EXECUTE: "execute",
});

function getRedisConfig() {
  return {
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
  };
}

module.exports = {
  QUEUE_NAMES,
  JOB_NAMES,
  getRedisConfig,
};
