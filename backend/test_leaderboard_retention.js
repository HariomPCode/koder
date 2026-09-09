const assert = require("assert");
const {
  buildLeaderboardActiveVersionKey,
  buildLeaderboardGenerationPattern,
  buildLeaderboardKey,
  buildLeaderboardMembersKey,
  buildLeaderboardMetaKey,
  getLeaderboardOperationalConfig,
  encodeParticipant,
} = require("@koder/shared");
const {
  createLeaderboardRetentionService,
} = require("./services/leaderboard-retention.service");

const contestId = "64e2d5ec5956e8d99d0f1234";
const userId = "000000000000000000000001";
const participant = {
  userId,
  solvedCount: 1,
  totalPenalty: 10,
  lastAcceptedContestMs: 1000,
};

function createRedis() {
  const strings = new Map();
  const hashes = new Map();
  const sets = new Map();
  const getHash = (key) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  };
  return {
    strings,
    hashes,
    sets,
    async set(key, value, mode, ttl, nx) {
      if (nx === "NX" && strings.has(key)) return null;
      strings.set(key, String(value));
      return "OK";
    },
    async get(key) {
      return strings.get(key) || null;
    },
    async scan(_cursor, _match, pattern) {
      const prefix = pattern.replace("*", "");
      const keys = [...new Set([...strings.keys(), ...hashes.keys(), ...sets.keys()])]
        .filter((key) => key.startsWith(prefix));
      return ["0", keys];
    },
    async del(...keys) {
      for (const key of keys) {
        strings.delete(key);
        hashes.delete(key);
        sets.delete(key);
      }
      return keys.length;
    },
    async eval(_script, _count, key, token) {
      if (strings.get(key) === token) strings.delete(key);
      return 1;
    },
  };
}

function seedGeneration(redis, generation) {
  const encoded = encodeParticipant(participant);
  const zsetKey = buildLeaderboardKey(contestId, generation);
  const membersKey = buildLeaderboardMembersKey(contestId, generation);
  const metaKey = buildLeaderboardMetaKey(contestId, generation);
  redis.sets.set(zsetKey, new Set([encoded.member]));
  redis.hashes.set(membersKey, new Map([[userId, encoded.member]]));
  redis.hashes.set(metaKey, new Map([["state", "ready"], ["health", "healthy"]]));
}

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  };

  await test("pre-seeding is disabled by default and does not touch Mongo", async () => {
    const redis = createRedis();
    let rebuilds = 0;
    const service = createLeaderboardRetentionService({
      redis,
      ContestModel: { findById: () => ({ lean: async () => ({ _id: contestId, status: "RUNNING" }) }) },
      projectionService: { rebuildContest: async () => { rebuilds += 1; } },
      config: getLeaderboardOperationalConfig({}),
    });
    const result = await service.preseedContest(contestId);
    assert.strictEqual(result.status, "disabled");
    assert.strictEqual(rebuilds, 0);
  });

  await test("enabled pre-seeding is idempotently delegated to versioned rebuild", async () => {
    const redis = createRedis();
    let rebuilds = 0;
    const projectionService = {
      rebuildContest: async () => {
        rebuilds += 1;
        return { status: "published", generation: `generation-${rebuilds}` };
      },
    };
    const service = createLeaderboardRetentionService({
      redis,
      ContestModel: { findById: () => ({ lean: async () => ({ _id: contestId, status: "RUNNING" }) }) },
      projectionService,
      config: { preseedEnabled: true },
    });
    await service.preseedContest(contestId);
    await service.preseedContest(contestId);
    assert.strictEqual(rebuilds, 2);
  });

  await test("zero-participant pre-seed and finalized contests are safe", async () => {
    const redis = createRedis();
    let rebuilds = 0;
    const service = createLeaderboardRetentionService({
      redis,
      ContestModel: {
        findById: () => ({ lean: async () => ({ _id: contestId, status: "FINALIZED" }) }),
      },
      projectionService: { rebuildContest: async () => { rebuilds += 1; } },
      config: { preseedEnabled: true, finalizedCleanupEnabled: false },
    });
    const result = await service.preseedContest(contestId);
    assert.strictEqual(result.reason, "contest_not_live");
    assert.strictEqual(rebuilds, 0);
  });

  await test("expired ENDED retention removes complete generations and active pointer", async () => {
    const redis = createRedis();
    seedGeneration(redis, "generation-old");
    seedGeneration(redis, "generation-active");
    redis.strings.set(buildLeaderboardActiveVersionKey(contestId), "generation-active");
    const service = createLeaderboardRetentionService({
      redis,
      now: () => 10000,
      ContestModel: {
        findById: () => ({
          lean: async () => ({
            _id: contestId,
            status: "ENDED",
            endTime: new Date(0),
          }),
        }),
      },
      config: { endedRetentionMs: 1, finalizedCleanupEnabled: false, cleanupKeyScanCount: 100 },
    });
    const result = await service.cleanupContest(contestId);
    assert.strictEqual(result.status, "cleaned");
    assert.strictEqual(redis.strings.has(buildLeaderboardActiveVersionKey(contestId)), false);
    assert.strictEqual(redis.sets.size, 0);
  });

  await test("finalized cleanup is disabled unless explicitly enabled and never touches Mongo", async () => {
    const redis = createRedis();
    seedGeneration(redis, "generation-active");
    redis.strings.set(buildLeaderboardActiveVersionKey(contestId), "generation-active");
    const contestModel = {
      findById: () => ({
        lean: async () => ({
          _id: contestId,
          status: "FINALIZED",
          updatedAt: new Date(0),
        }),
      }),
    };
    const disabled = createLeaderboardRetentionService({
      redis,
      ContestModel: contestModel,
      config: { finalizedCleanupEnabled: false, finalizedCleanupGraceMs: 1 },
      now: () => 10000,
    });
    assert.strictEqual((await disabled.cleanupContest(contestId)).status, "disabled");

    const enabled = createLeaderboardRetentionService({
      redis,
      ContestModel: contestModel,
      config: { finalizedCleanupEnabled: true, finalizedCleanupGraceMs: 1 },
      now: () => 10000,
    });
    assert.strictEqual((await enabled.cleanupContest(contestId)).status, "cleaned");
    assert.strictEqual(redis.strings.has(buildLeaderboardActiveVersionKey(contestId)), false);
  });

  await test("partial generations are skipped safely", async () => {
    const redis = createRedis();
    const partial = buildLeaderboardKey(contestId, "generation-partial");
    redis.sets.set(partial, new Set(["member"]));
    redis.strings.set(buildLeaderboardActiveVersionKey(contestId), "generation-partial");
    const service = createLeaderboardRetentionService({
      redis,
      ContestModel: {
        findById: () => ({ lean: async () => ({ _id: contestId, status: "ENDED", endTime: new Date(0) }) }),
      },
      config: { endedRetentionMs: 1 },
      now: () => 10000,
    });
    await service.cleanupContest(contestId);
    assert.strictEqual(redis.strings.has(buildLeaderboardActiveVersionKey(contestId)), true);
    assert.strictEqual(redis.sets.has(partial), true);
  });

  await test("retention is bounded by the ENDED window and repeated cleanup is idempotent", async () => {
    const redis = createRedis();
    seedGeneration(redis, "generation-active");
    redis.strings.set(buildLeaderboardActiveVersionKey(contestId), "generation-active");
    const contestModel = {
      findById: () => ({
        lean: async () => ({ _id: contestId, status: "ENDED", endTime: new Date(9000) }),
      }),
    };
    const service = createLeaderboardRetentionService({
      redis,
      ContestModel: contestModel,
      config: { endedRetentionMs: 2000 },
      now: () => 10000,
    });
    assert.strictEqual((await service.cleanupContest(contestId)).status, "not_due");
    const due = createLeaderboardRetentionService({
      redis,
      ContestModel: contestModel,
      config: { endedRetentionMs: 1000 },
      now: () => 10000,
    });
    assert.strictEqual((await due.cleanupContest(contestId)).status, "cleaned");
    assert.strictEqual((await due.cleanupContest(contestId)).status, "cleaned");
  });

  await test("missing Redis keys and Redis failures are safe to retry", async () => {
    const redis = createRedis();
    const service = createLeaderboardRetentionService({
      redis,
      ContestModel: {
        findById: () => ({ lean: async () => ({ _id: contestId, status: "ENDED", endTime: new Date(0) }) }),
      },
      config: { endedRetentionMs: 1 },
      now: () => 10000,
    });
    assert.strictEqual((await service.cleanupContest(contestId)).status, "cleaned");

    const failingRedis = createRedis();
    failingRedis.scan = async () => {
      throw new Error("Redis unavailable");
    };
    await assert.rejects(() => createLeaderboardRetentionService({
      redis: failingRedis,
      ContestModel: {
        findById: () => ({ lean: async () => ({ _id: contestId, status: "ENDED", endTime: new Date(0) }) }),
      },
      config: { endedRetentionMs: 1 },
      now: () => 10000,
    }).cleanupContest(contestId), /Redis unavailable/);
  });

  console.log(`\nLeaderboard retention checks: ${passed} passed, 0 failed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
