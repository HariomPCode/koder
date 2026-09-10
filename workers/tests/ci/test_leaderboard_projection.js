const assert = require("assert");
const {
  LEADERBOARD_PROJECTION_JOB_NAME,
  LEADERBOARD_PROJECTION_QUEUE_NAME,
  buildLeaderboardActiveVersionKey,
  buildLeaderboardKey,
  buildLeaderboardMembersKey,
  buildLeaderboardMetaKey,
  encodeParticipant,
} = require("../../../packages/shared");
const {
  createLeaderboardProjectionEnqueuer,
} = require("../../leaderboard/producer");
const {
  createProjectionProcessor,
} = require("../../leaderboard/projectionProcessor");

const contestId = "64e2d5ec5956e8d99d0f1234";
const userId = "000000000000000000000001";

function modelWith(valueFactory) {
  return {
    findById: () => ({ lean: async () => valueFactory() }),
    findOne: () => ({ lean: async () => valueFactory() }),
  };
}

function createFakeRedis() {
  const values = new Map();
  const hashes = new Map();
  const sorted = new Map();
  const calls = [];

  return {
    values,
    hashes,
    sorted,
    calls,
    async get(key) {
      return values.get(key) || null;
    },
    async hget(key, field) {
      return hashes.get(key)?.get(field) || null;
    },
    async eval(_script, _keyCount, zsetKey, membersKey, metaKey, oldMember, member, score, id, refreshedAt) {
      calls.push({ zsetKey, membersKey, metaKey, oldMember, member, score, id, refreshedAt });
      const members = hashes.get(membersKey) || new Map();
      const zset = sorted.get(zsetKey) || new Map();
      if (oldMember && oldMember !== member) zset.delete(oldMember);
      zset.set(member, Number(score));
      members.set(id, member);
      hashes.set(membersKey, members);
      const meta = hashes.get(metaKey) || new Map();
      meta.set("lastSuccessfulRefreshAt", refreshedAt);
      meta.set("health", "healthy");
      hashes.set(metaKey, meta);
      sorted.set(zsetKey, zset);
      return 1;
    },
  };
}

async function runTests() {
  const participant = {
    contestId,
    userId,
    solvedCount: 1,
    totalPenalty: 12,
    lastAcceptedContestMs: 60000,
  };
  let currentParticipant = { ...participant };
  const contest = { _id: contestId, status: "RUNNING" };
  const redis = createFakeRedis();
  redis.values.set(buildLeaderboardActiveVersionKey(contestId), "generation-1");
  redis.hashes.set(buildLeaderboardMetaKey(contestId, "generation-1"), new Map([
    ["state", "ready"],
    ["health", "healthy"],
  ]));

  const processor = createProjectionProcessor({
    ContestModel: modelWith(() => contest),
    ContestParticipantModel: modelWith(() => ({ ...currentParticipant })),
    redis,
    now: () => 123,
  });

  const first = await processor({ data: { contestId, userId, solvedCount: 999, rank: 1 } });
  assert.strictEqual(first.processed, true);
  assert.deepStrictEqual(Object.keys({ contestId, userId }), ["contestId", "userId"]);
  assert.strictEqual(first.score, -1);
  assert.strictEqual(first.member, encodeParticipant(participant).member);
  assert.strictEqual(
    redis.calls[0].zsetKey,
    buildLeaderboardKey(contestId, "generation-1"),
  );
  assert.strictEqual(
    redis.calls[0].membersKey,
    buildLeaderboardMembersKey(contestId, "generation-1"),
  );

  const duplicate = await processor({ data: { contestId, userId } });
  assert.strictEqual(duplicate.processed, true);
  assert.strictEqual(redis.sorted.get(buildLeaderboardKey(contestId, "generation-1")).size, 1);

  currentParticipant = {
    ...currentParticipant,
    solvedCount: 2,
    totalPenalty: 20,
    lastAcceptedContestMs: 120000,
  };
  const afterMutation = await processor({ data: { contestId, userId } });
  assert.strictEqual(afterMutation.score, -2);
  assert.strictEqual(redis.sorted.get(buildLeaderboardKey(contestId, "generation-1")).size, 1);
  assert.strictEqual(
    redis.hashes.get(buildLeaderboardMembersKey(contestId, "generation-1")).get(userId),
    encodeParticipant(currentParticipant).member,
  );

  const missing = createProjectionProcessor({
    ContestModel: modelWith(() => contest),
    ContestParticipantModel: modelWith(() => null),
    redis,
  });
  assert.strictEqual((await missing({ data: { contestId, userId } })).reason, "participant_not_found");

  const finalized = createProjectionProcessor({
    ContestModel: modelWith(() => ({ ...contest, status: "FINALIZED" })),
    ContestParticipantModel: modelWith(() => participant),
    redis,
  });
  assert.strictEqual((await finalized({ data: { contestId, userId } })).reason, "contest_not_live");

  const failingRedis = {
    async get() { throw new Error("redis unavailable"); },
  };
  await assert.rejects(
    () => createProjectionProcessor({
      ContestModel: modelWith(() => contest),
      ContestParticipantModel: modelWith(() => participant),
      redis: failingRedis,
    })({ data: { contestId, userId } }),
    /redis unavailable/,
  );

  const added = [];
  const enqueue = createLeaderboardProjectionEnqueuer({
    queue: {
      async add(name, payload, options) {
        added.push({ name, payload, options });
        return { id: "job-1" };
      },
    },
  });
  await enqueue({ contestId, userId });
  assert.strictEqual(added[0].name, LEADERBOARD_PROJECTION_JOB_NAME);
  assert.deepStrictEqual(added[0].payload, { contestId, userId });
  assert.ok(added[0].options.attempts >= 1);
  assert.strictEqual(LEADERBOARD_PROJECTION_QUEUE_NAME, "leaderboard-projection-queue");

  console.log("Leaderboard projection worker tests passed");
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
