const assert = require("assert");
const {
  buildLeaderboardActiveVersionKey,
  buildLeaderboardKey,
  buildLeaderboardMembersKey,
  buildLeaderboardMetaKey,
  encodeParticipant,
} = require("@koder/shared");
const {
  createStandingsReader,
} = require("./services/standings.service");
const ContestService = require("./services/contest.service");
const ContestRepository = require("./repositories/contest.repository");
const standingsService = require("./services/standings.service");
const queue = require("./queue");

const contest = {
  _id: "64e2d5ec5956e8d99d0f1234",
  status: "RUNNING",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
};

const participants = [
  {
    userId: "000000000000000000000001",
    solvedCount: 2,
    totalPenalty: 20,
    lastAcceptedContestMs: 2000,
  },
  {
    userId: "000000000000000000000002",
    solvedCount: 2,
    totalPenalty: 20,
    lastAcceptedContestMs: 2000,
  },
  {
    userId: "000000000000000000000003",
    solvedCount: 1,
    totalPenalty: 10,
    lastAcceptedContestMs: 1000,
  },
];

function createRedis() {
  const strings = new Map();
  const hashes = new Map();
  const zsets = new Map();
  const getHash = (key) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  };
  const getZset = (key) => {
    if (!zsets.has(key)) zsets.set(key, new Map());
    return zsets.get(key);
  };
  const sorted = (key) =>
    [...getZset(key).entries()].sort(([memberA, scoreA], [memberB, scoreB]) => {
      if (scoreA !== scoreB) return scoreA - scoreB;
      return memberA.localeCompare(memberB);
    });

  return {
    strings,
    hashes,
    zsets,
    async get(key) {
      return strings.get(key) || null;
    },
    async hgetall(key) {
      return Object.fromEntries(getHash(key));
    },
    async hget(key, field) {
      return getHash(key).get(field) || null;
    },
    async zcard(key) {
      return getZset(key).size;
    },
    async zrange(key, start, stop, withScores) {
      assert.strictEqual(withScores, "WITHSCORES");
      const values = sorted(key).slice(start, stop + 1);
      return values.flatMap(([member, score]) => [member, String(score)]);
    },
    async zscore(key, member) {
      const score = getZset(key).get(member);
      return score == null ? null : String(score);
    },
    async zrank(key, member) {
      const index = sorted(key).findIndex(([candidate]) => candidate === member);
      return index < 0 ? null : index;
    },
  };
}

function seedRedis(redis, generation = "generation-1") {
  const contestId = String(contest._id);
  redis.strings.set(buildLeaderboardActiveVersionKey(contestId), generation);
  redis.hashes.set(
    buildLeaderboardMetaKey(contestId, generation),
    new Map([
      ["state", "ready"],
      ["health", "healthy"],
      ["generation", generation],
      ["lastSuccessfulRefreshAt", String(Date.now())],
    ]),
  );
  const zset = new Map();
  const members = new Map();
  for (const participant of participants) {
    const encoded = encodeParticipant(participant);
    zset.set(encoded.member, encoded.score);
    members.set(participant.userId, encoded.member);
  }
  redis.zsets.set(buildLeaderboardKey(contestId, generation), zset);
  redis.hashes.set(buildLeaderboardMembersKey(contestId, generation), members);
}

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  };

  const redis = createRedis();
  seedRedis(redis);
  const reader = createStandingsReader({ redis });

  await test("RUNNING healthy Redis returns deterministic ordinal standings", async () => {
    const result = await reader.readRedisStandings({ contest, page: 1, limit: 2 });
    assert.deepStrictEqual(result.standings.map((entry) => entry.rank), [1, 2]);
    assert.deepStrictEqual(
      result.standings.map((entry) => String(entry.userId)),
      participants.slice(0, 2).map((entry) => entry.userId),
    );
    assert.strictEqual(result.pagination.total, 3);
  });

  await test("ENDED contests use the same healthy Redis read contract", async () => {
    const ended = { ...contest, status: "ENDED" };
    const result = await reader.readRedisStandings({ contest: ended, page: 2, limit: 2 });
    assert.deepStrictEqual(result.standings.map((entry) => entry.rank), [3]);
  });

  await test("Redis personal standing returns the authoritative global ordinal rank", async () => {
    const result = await reader.readRedisMyStanding({
      contest,
      userId: participants[2].userId,
    });
    assert.strictEqual(result.rank, 3);
    assert.strictEqual(result.solvedCount, 1);
  });

  await test("missing generation, rebuilding metadata, malformed members, and missing hashes fail safely", async () => {
    const missing = createRedis();
    await assert.rejects(
      () => reader.readRedisStandings({ contest, page: 1, limit: 2, redis: missing }),
      /active generation/i,
    );

    const rebuilding = createRedis();
    seedRedis(rebuilding);
    rebuilding.hashes.get(buildLeaderboardMetaKey(contest._id, "generation-1")).set("state", "rebuilding");
    await assert.rejects(
      () => reader.readRedisStandings({ contest, page: 1, limit: 2, redis: rebuilding }),
      /not ready/i,
    );

    const malformed = createRedis();
    seedRedis(malformed);
    const zsetKey = buildLeaderboardKey(contest._id, "generation-1");
    const firstMember = [...malformed.zsets.get(zsetKey).keys()][0];
    const score = malformed.zsets.get(zsetKey).get(firstMember);
    malformed.zsets.get(zsetKey).delete(firstMember);
    malformed.zsets.get(zsetKey).set("malformed", score);
    await assert.rejects(
      () => reader.readRedisStandings({ contest, page: 1, limit: 2, redis: malformed }),
      /invalid leaderboard token/i,
    );

    const missingHash = createRedis();
    seedRedis(missingHash);
    missingHash.hashes.get(buildLeaderboardMembersKey(contest._id, "generation-1")).clear();
    await assert.rejects(
      () => reader.readRedisStandings({ contest, page: 1, limit: 2, redis: missingHash }),
      /missing or stale/i,
    );
  });

  await test("active generation changes during a read and empty/page-beyond-end are rejected or correct", async () => {
    const switched = createRedis();
    seedRedis(switched);
    const originalGet = switched.get.bind(switched);
    let gets = 0;
    switched.get = async (key) => {
      gets += 1;
      if (gets === 2) return "generation-2";
      return originalGet(key);
    };
    await assert.rejects(
      () => reader.readRedisStandings({ contest, page: 1, limit: 2, redis: switched }),
      /generation changed/i,
    );

    const empty = createRedis();
    seedRedis(empty);
    empty.zsets.get(buildLeaderboardKey(contest._id, "generation-1")).clear();
    const result = await reader.readRedisStandings({ contest, page: 2, limit: 2, redis: empty });
    assert.deepStrictEqual(result.standings, []);
    assert.strictEqual(result.pagination.total, 0);
  });

  await test("Mongo fallback preserves ordinal pagination and /me identity", async () => {
    const originalRead = standingsService.readRedisStandings;
    const originalMyRead = standingsService.readRedisMyStanding;
    const originalFindById = ContestRepository.findById;
    const originalCount = ContestRepository.countParticipants;
    const originalPage = ContestRepository.findParticipantsPaginated;
    const originalFindParticipant = ContestRepository.findParticipant;
    const originalAhead = ContestRepository.countParticipantsAhead;
    try {
      standingsService.readRedisStandings = async () => {
        throw new Error("Redis unavailable");
      };
      standingsService.readRedisMyStanding = async () => {
        throw new Error("Redis unavailable");
      };
      ContestRepository.findById = async () => ({ ...contest });
      ContestRepository.countParticipants = async () => participants.length;
      ContestRepository.findParticipantsPaginated = async (_contestId, { skip, limit }) =>
        participants.slice(skip, skip + limit).map((entry) => ({ ...entry }));
      ContestRepository.findParticipant = async (_contestId, userId) =>
        participants.find((entry) => entry.userId === String(userId)) || null;
      ContestRepository.countParticipantsAhead = async () => 2;

      const page = await ContestService.getContestStandings({ contestId: contest._id, page: 2, limit: 2 });
      assert.deepStrictEqual(page.standings.map((entry) => entry.rank), [3]);
      const mine = await ContestService.getMyContestStanding({
        contestId: contest._id,
        userId: participants[2].userId,
      });
      assert.strictEqual(mine.standing.rank, 3);
    } finally {
      ContestRepository.findById = originalFindById;
      ContestRepository.countParticipants = originalCount;
      ContestRepository.findParticipantsPaginated = originalPage;
      ContestRepository.findParticipant = originalFindParticipant;
      ContestRepository.countParticipantsAhead = originalAhead;
      standingsService.readRedisStandings = originalRead;
      standingsService.readRedisMyStanding = originalMyRead;
    }
  });

  await test("FINALIZED reads never call Redis", async () => {
    const finalized = { ...contest, status: "FINALIZED" };
    await assert.rejects(
      () => reader.readRedisStandings({ contest: finalized, page: 1, limit: 2 }),
      /only available for live/i,
    );
  });

  console.log(`\nRedis standings checks: ${passed} passed, 0 failed`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([
      queue.jsQueue.close(),
      queue.javaQueue.close(),
      queue.pythonQueue.close(),
    ]);
    await queue.connection.quit();
  });
