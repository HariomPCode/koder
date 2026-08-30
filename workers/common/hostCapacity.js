const IoRedis = require("ioredis");
const { getRedisConfig, getHostCapacityConfig } = require("@koder/shared");

const ACTIVE_EXECUTIONS_KEY = "koder:host:activeExecutions";
const connection = new IoRedis({
  ...getRedisConfig(),
  maxRetriesPerRequest: null,
});

async function getActiveExecutionCount() {
  const value = await connection.get(ACTIVE_EXECUTIONS_KEY);
  return Number(value || 0);
}

async function reserveExecutionSlot({
  key = ACTIVE_EXECUTIONS_KEY,
  limit = getHostCapacityConfig().maxActiveJobs,
} = {}) {
  const maxActiveJobs = Number(limit) || 1;
  const current = await connection.incr(key);

  if (current > maxActiveJobs) {
    await connection.decr(key);
    return {
      acquired: false,
      active: current,
      limit: maxActiveJobs,
    };
  }

  return {
    acquired: true,
    active: current,
    limit: maxActiveJobs,
  };
}

async function releaseExecutionSlot({ key = ACTIVE_EXECUTIONS_KEY } = {}) {
  const next = await connection.decr(key);
  if (Number.isNaN(next) || next < 0) {
    await connection.set(key, "0");
    return 0;
  }
  return next;
}

module.exports = {
  ACTIVE_EXECUTIONS_KEY,
  connection,
  getActiveExecutionCount,
  reserveExecutionSlot,
  releaseExecutionSlot,
};
