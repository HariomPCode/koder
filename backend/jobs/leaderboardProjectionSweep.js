const IoRedis = require("ioredis");
const {
  Contest,
  getRedisConfig,
} = require("@koder/shared");
const {
  enqueueLeaderboardProjection,
} = require("../queue/leaderboardProjectionQueue");
const {
  buildLeaderboardSweepLockKey,
} = require("@koder/shared");
const {
  createLeaderboardProjectionService,
} = require("../services/leaderboard-projection.service");

const SWEEP_INTERVAL_MS = 60 * 1000;
const SWEEP_LOCK_TTL_MS = 55 * 1000;

function createSweepRunner({
  redis,
  service,
  lockTtlMs = SWEEP_LOCK_TTL_MS,
} = {}) {
  if (!redis || !service) {
    throw new TypeError("redis and service are required");
  }

  return async function runSweep(options = {}) {
    const lockKey = buildLeaderboardSweepLockKey();
    const lockToken = `${process.pid}:${Date.now()}`;
    const acquired = await redis.set(lockKey, lockToken, "PX", lockTtlMs, "NX");
    if (acquired !== "OK") {
      return { skipped: "already_running", results: [] };
    }
    try {
      return {
        skipped: null,
        results: await service.sweepLiveProjections(options),
      };
    } finally {
      await redis.eval(
        `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`,
        1,
        lockKey,
        lockToken,
      ).catch(() => {});
    }
  };
}

function createDefaultSweepRunner() {
  const redis = new IoRedis(getRedisConfig());
  const service = createLeaderboardProjectionService({
    ContestModel: Contest,
    redis,
    enqueueProjection: enqueueLeaderboardProjection,
  });
  return { redis, runSweep: createSweepRunner({ redis, service }) };
}

function startLeaderboardProjectionSweep({
  intervalMs = SWEEP_INTERVAL_MS,
  runner = null,
} = {}) {
  const owned = runner ? null : createDefaultSweepRunner();
  const run = runner || owned.runSweep;
  const timer = setInterval(() => {
    run().catch((error) => {
      console.error("Leaderboard projection sweep failed:", error.message || error);
    });
  }, intervalMs);
  timer.unref?.();
  run().catch((error) => {
    console.error("Leaderboard projection startup sweep failed:", error.message || error);
  });
  return {
    timer,
    async stop() {
      clearInterval(timer);
      if (owned) {
        await owned.redis.quit();
      }
    },
  };
}

module.exports = {
  SWEEP_INTERVAL_MS,
  createSweepRunner,
  startLeaderboardProjectionSweep,
};
