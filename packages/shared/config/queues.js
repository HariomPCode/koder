/**
 * Pure queue names, job names, redis, retry, and retention configuration constants.
 * Does NOT instantiate any live connection or Queue instances.
 */

const QUEUE_NAMES = Object.freeze({
  javascript: "js-queue",
  java: "java-queue",
  python: "python-queue",
});

const JOB_NAMES = Object.freeze({
  EXECUTE: "execute",
});

const QUEUE_RETRY_DEFAULTS = Object.freeze({
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
});

const QUEUE_RETENTION_DEFAULTS = Object.freeze({
  completed: {
    age: 24 * 60 * 60,
    count: 5000,
  },
  failed: {
    age: 7 * 24 * 60 * 60,
    count: 2000,
  },
});

const QUEUE_STALL_DEFAULTS = Object.freeze({
  stalledInterval: 30 * 1000,
  maxStalledCount: 2,
  lockDuration: 60 * 1000,
});

const DEFAULT_HOST_CAPACITY = Object.freeze({
  maxActiveJobs: 4,
  cpuPerJob: 1,
  memoryMiBPerJob: 256,
  pidsPerJob: 64,
});

const DEFAULT_WORKER_CONCURRENCY = Object.freeze({
  javascript: 1,
  java: 1,
  python: 1,
});

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function getRedisConfig() {
  return {
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
  };
}

function getHostCapacityConfig() {
  const maxActiveJobs = parsePositiveInt(
    process.env.WORKER_MAX_ACTIVE_JOBS ?? process.env.KODER_WORKER_MAX_ACTIVE_JOBS,
    DEFAULT_HOST_CAPACITY.maxActiveJobs,
  );

  return {
    maxActiveJobs,
    cpuPerJob: parsePositiveInt(process.env.WORKER_CPU_PER_JOB ?? "1", DEFAULT_HOST_CAPACITY.cpuPerJob),
    memoryMiBPerJob: parsePositiveInt(process.env.WORKER_MEMORY_MIB_PER_JOB ?? process.env.WORKER_MEMORY_MB_PER_JOB ?? "256", DEFAULT_HOST_CAPACITY.memoryMiBPerJob),
    pidsPerJob: parsePositiveInt(process.env.WORKER_PIDS_PER_JOB ?? "64", DEFAULT_HOST_CAPACITY.pidsPerJob),
  };
}

function getWorkerConcurrencyConfig(language) {
  const normalizedLanguage = String(language || "").toLowerCase();
  const defaults = DEFAULT_WORKER_CONCURRENCY;
  const envVarByLanguage = {
    javascript: "KODER_WORKER_CONCURRENCY_JS",
    java: "KODER_WORKER_CONCURRENCY_JAVA",
    python: "KODER_WORKER_CONCURRENCY_PYTHON",
  };

  const fallback = defaults[normalizedLanguage] ?? 1;
  const envVar = envVarByLanguage[normalizedLanguage];
  const concurrency = parsePositiveInt(
    envVar ? process.env[envVar] : undefined,
    fallback,
  );

  return {
    language: normalizedLanguage,
    concurrency,
    hostMaxActiveJobs: getHostCapacityConfig().maxActiveJobs,
    effectiveConcurrency: Math.min(concurrency, getHostCapacityConfig().maxActiveJobs),
  };
}

function buildQueueJobId(language, submissionId) {
  const normalizedLanguage = String(language || "").trim().toLowerCase();
  return `${normalizedLanguage}-${String(submissionId)}`;
}

function createQueueJobOptions(overrides = {}) {
  return {
    attempts: overrides.attempts ?? QUEUE_RETRY_DEFAULTS.attempts,
    backoff: {
      ...QUEUE_RETRY_DEFAULTS.backoff,
      ...(overrides.backoff || {}),
    },
    removeOnComplete: overrides.removeOnComplete ?? {
      age: QUEUE_RETENTION_DEFAULTS.completed.age,
      count: QUEUE_RETENTION_DEFAULTS.completed.count,
    },
    removeOnFail: overrides.removeOnFail ?? {
      age: QUEUE_RETENTION_DEFAULTS.failed.age,
      count: QUEUE_RETENTION_DEFAULTS.failed.count,
    },
  };
}

module.exports = {
  QUEUE_NAMES,
  JOB_NAMES,
  QUEUE_RETRY_DEFAULTS,
  QUEUE_RETENTION_DEFAULTS,
  QUEUE_STALL_DEFAULTS,
  DEFAULT_HOST_CAPACITY,
  DEFAULT_WORKER_CONCURRENCY,
  getRedisConfig,
  getHostCapacityConfig,
  getWorkerConcurrencyConfig,
  buildQueueJobId,
  createQueueJobOptions,
};
