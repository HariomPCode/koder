const assert = require("assert");
const {
  buildLeaderboardActiveVersionKey,
  buildLeaderboardKey,
  buildLeaderboardMembersKey,
  buildLeaderboardMetaKey,
  buildLeaderboardRebuildLockKey,
  encodeParticipant,
  LEADERBOARD_HEALTH,
  LEADERBOARD_META_STATE,
} = require("@koder/shared");
const {
  createLeaderboardProjectionService,
} = require("../../services/leaderboard-projection.service");

const CONTEST_ID = "64e2d5ec5956e8d99d0f1234";
const USERS = [
  "000000000000000000000001",
  "000000000000000000000002",
  "000000000000000000000003",
];

function createCursor(items) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

function createRedis({ failOn = null } = {}) {
  const strings = new Map();
  const hashes = new Map();
  const zsets = new Map();
  const calls = [];

  const fail = (name) => {
    if (failOn === name) throw new Error(`${name} unavailable`);
  };
  const hash = (key) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  };
  const zset = (key) => {
    if (!zsets.has(key)) zsets.set(key, new Map());
    return zsets.get(key);
  };

  const redis = {
    strings,
    hashes,
    zsets,
    calls,
    async set(key, value, mode, ttl, nx) {
      fail("set");
      if (nx === "NX" && strings.has(key)) return null;
      strings.set(key, String(value));
      return "OK";
    },
    async get(key) {
      fail("get");
      return strings.get(key) || null;
    },
    async pexpire() {
      return 1;
    },
    async del(...keys) {
      for (const key of keys) {
        strings.delete(key);
        hashes.delete(key);
        zsets.delete(key);
      }
      return keys.length;
    },
    async hset(key, values, value) {
      fail("hset");
      const target = hash(key);
      if (typeof values === "object") {
        for (const [field, fieldValue] of Object.entries(values)) target.set(field, String(fieldValue));
      } else {
        target.set(String(values), String(value));
      }
      return target.size;
    },
    async hget(key, field) {
      fail("hget");
      return hash(key).get(String(field)) || null;
    },
    async hgetall(key) {
      fail("hgetall");
      return Object.fromEntries(hash(key));
    },
    async hlen(key) {
      return hash(key).size;
    },
    async zcard(key) {
      return zset(key).size;
    },
    async zscore(key, member) {
      return zset(key).has(member) ? String(zset(key).get(member)) : null;
    },
    pipeline() {
      const commands = [];
      return {
        zadd: (key, score, member) => commands.push(() => zset(key).set(member, Number(score))),
        hset: (key, field, value) => commands.push(() => hash(key).set(field, String(value))),
        exec: async () => {
          fail("pipeline");
          commands.forEach((command) => command());
          return [];
        },
      };
    },
    async eval(script, keyCount, ...args) {
      calls.push({ script, keyCount, args });
      if (script.includes("ARGV[1]") && script.includes("DEL")) {
        const [key, token] = args;
        if (strings.get(key) === token) {
          strings.delete(key);
          return 1;
        }
        return 0;
      }
      if (script.includes('state ~= "ready"') && script.includes('redis.call("SET"')) {
        const [activeKey, metaKey, generation] = args;
        const meta = hash(metaKey);
        if (meta.get("state") !== "ready" || meta.get("health") !== "healthy") return 0;
        strings.set(activeKey, generation);
        return 1;
      }
      return 1;
    },
  };
  return redis;
}

function createModels(participants) {
  return {
    ContestModel: {
      findById: () => ({ lean: async () => ({ _id: CONTEST_ID, status: "RUNNING" }) }),
      find: () => ({
        select: () => ({
          lean: () => ({ cursor: () => createCursor([{ _id: CONTEST_ID }]) }),
        }),
      }),
    },
    repository: {
      countParticipants: async () => participants.length,
      cursorParticipants: () => createCursor(participants),
    },
  };
}

async function run() {
  const participants = USERS.map((userId, index) => ({
    userId,
    solvedCount: index,
    totalPenalty: index * 10,
    lastAcceptedContestMs: index ? index * 100 : null,
    updatedAt: new Date(1000 + index),
  }));
  const redis = createRedis();
  const models = createModels(participants);
  const service = createLeaderboardProjectionService({
    ...models,
    redis,
    now: () => 5000,
    uuid: () => "fixed",
    batchSize: 2,
  });

  const first = await service.rebuildContest(CONTEST_ID, { reason: "test" });
  assert.strictEqual(first.status, "published");
  assert.strictEqual(first.participantCount, participants.length);
  assert.strictEqual(
    await redis.get(buildLeaderboardActiveVersionKey(CONTEST_ID)),
    first.generation,
  );
  assert.strictEqual(
    redis.zsets.get(buildLeaderboardKey(CONTEST_ID, first.generation)).size,
    participants.length,
  );
  assert.strictEqual(
    redis.hashes.get(buildLeaderboardMetaKey(CONTEST_ID, first.generation)).get("state"),
    LEADERBOARD_META_STATE.READY,
  );
  assert.deepStrictEqual(
    encodeParticipant(participants[1]),
    {
      score: -1,
      member: redis.hashes.get(buildLeaderboardMembersKey(CONTEST_ID, first.generation)).get(USERS[1]),
    },
  );

  const drift = await service.checkDrift(CONTEST_ID);
  assert.strictEqual(drift.drifted, false);

  const blocked = createLeaderboardProjectionService({
    ...models,
    redis,
    now: () => 6000,
    uuid: () => "other",
  });
  await redis.set(buildLeaderboardRebuildLockKey(CONTEST_ID), "held", "PX", 60000, "NX");
  const concurrent = await blocked.rebuildContest(CONTEST_ID);
  assert.strictEqual(concurrent.status, "already_running");
  await redis.del(buildLeaderboardRebuildLockKey(CONTEST_ID));

  const failedRedis = createRedis({ failOn: "pipeline" });
  const failedService = createLeaderboardProjectionService({
    ...models,
    redis: failedRedis,
    now: () => 7000,
    uuid: () => "failed",
  });
  await assert.rejects(() => failedService.rebuildContest(CONTEST_ID), /pipeline unavailable/);
  assert.strictEqual(await failedRedis.get(buildLeaderboardActiveVersionKey(CONTEST_ID)), null);

  const sweepJobs = [];
  participants.forEach((participant) => {
    participant.updatedAt = new Date(10000);
  });
  const sweepRedis = createRedis();
  const sweepService = createLeaderboardProjectionService({
    ...models,
    redis: sweepRedis,
    enqueueProjection: async (payload) => sweepJobs.push(payload),
    now: () => 9000,
    uuid: () => "sweep",
  });
  await sweepService.rebuildContest(CONTEST_ID);
  await sweepService.sweepContest(CONTEST_ID);
  assert.strictEqual(sweepJobs.length, participants.length);
  assert.strictEqual(sweepJobs[0].solvedCount, undefined);

  participants[0].solvedCount = 99;
  const drifted = await sweepService.checkDrift(CONTEST_ID);
  assert.strictEqual(drifted.drifted, true);

  const finalized = {
    ContestModel: {
      findById: () => ({ lean: async () => ({ _id: CONTEST_ID, status: "FINALIZED" }) }),
    },
    repository: models.repository,
  };
  const finalizedService = createLeaderboardProjectionService({
    ...finalized,
    redis: createRedis(),
    enqueueProjection: async () => {
      throw new Error("must not enqueue finalized contest");
    },
  });
  const finalizedSweep = await finalizedService.sweepContest(CONTEST_ID);
  assert.strictEqual(finalizedSweep.skipped, "not_live");

  console.log("Leaderboard rebuild checks: 10 passed, 0 failed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
