const IoRedis = require("ioredis");
const {
  buildLeaderboardActiveVersionKey,
  buildLeaderboardKey,
  buildLeaderboardMembersKey,
  buildLeaderboardMetaKey,
  decodeParticipant,
  getRedisConfig,
  LEADERBOARD_HEALTH,
  LEADERBOARD_META_STATE,
} = require("@koder/shared");

const MAX_PAGE_LIMIT = 100;
const LIVE_STATUSES = new Set(["RUNNING", "ENDED"]);

let redisConnection = null;

function getRedis() {
  if (!redisConnection) {
    redisConnection = new IoRedis(getRedisConfig());
  }
  return redisConnection;
}

async function closeRedis() {
  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }
}

function formatStanding({ contest, participant, rank }) {
  const solvedCount = participant.solvedCount || 0;
  const lastAcceptedAt =
    solvedCount > 0 && participant.lastAcceptedContestMs != null
      ? new Date(new Date(contest.startTime).getTime() + participant.lastAcceptedContestMs)
      : null;

  return {
    userId: participant.userId,
    rank,
    solvedCount,
    score: solvedCount,
    penalty: participant.totalPenalty || 0,
    ...(lastAcceptedAt ? { lastAcceptedAt } : {}),
  };
}

function paginationResult({ contest, page, limit, standings, total }) {
  return {
    contestId: contest._id,
    status: contest.status,
    standings,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  };
}

function assertUsableMetadata(meta, generation) {
  if (
    meta.state !== LEADERBOARD_META_STATE.READY ||
    meta.health !== LEADERBOARD_HEALTH.HEALTHY ||
    meta.generation !== generation
  ) {
    throw new Error("Redis leaderboard projection is not ready and healthy");
  }
}

async function readGeneration(redis, contestId) {
  const generation = await redis.get(buildLeaderboardActiveVersionKey(contestId));
  if (!generation) {
    throw new Error("Redis leaderboard active generation is missing");
  }

  const meta = await redis.hgetall(buildLeaderboardMetaKey(contestId, generation));
  assertUsableMetadata(meta, generation);
  return generation;
}

async function assertGenerationUnchanged(redis, contestId, generation) {
  const currentGeneration = await redis.get(buildLeaderboardActiveVersionKey(contestId));
  if (currentGeneration !== generation) {
    throw new Error("Redis leaderboard generation changed during read");
  }
}

async function readRedisStandings({
  contest,
  page,
  limit,
  redis = getRedis(),
} = {}) {
  if (!LIVE_STATUSES.has(String(contest.status))) {
    throw new Error("Redis standings are only available for live contests");
  }

  const contestId = String(contest._id);
  const generation = await readGeneration(redis, contestId);
  const zsetKey = buildLeaderboardKey(contestId, generation);
  const membersKey = buildLeaderboardMembersKey(contestId, generation);
  const total = Number(await redis.zcard(zsetKey));
  const skip = (page - 1) * limit;

  if (total === 0 || skip >= total) {
    await assertGenerationUnchanged(redis, contestId, generation);
    return paginationResult({ contest, page, limit, standings: [], total });
  }

  const rows = await redis.zrange(zsetKey, skip, skip + limit - 1, "WITHSCORES");
  if (rows.length % 2 !== 0) {
    throw new Error("Redis leaderboard returned malformed page data");
  }

  const seenUsers = new Set();
  const standings = [];
  for (let index = 0; index < rows.length; index += 2) {
    const member = rows[index];
    const score = rows[index + 1];
    const decoded = decodeParticipant({ score, member });
    const userId = decoded.userId;
    if (seenUsers.has(userId)) {
      throw new Error("Redis leaderboard returned duplicate participant data");
    }
    seenUsers.add(userId);

    const storedMember = await redis.hget(membersKey, userId);
    if (storedMember !== member) {
      throw new Error("Redis leaderboard participant metadata is missing or stale");
    }

    standings.push(
      formatStanding({
        contest,
        participant: decoded,
        rank: skip + standings.length + 1,
      }),
    );
  }

  await assertGenerationUnchanged(redis, contestId, generation);
  return paginationResult({ contest, page, limit, standings, total });
}

async function readRedisMyStanding({
  contest,
  userId,
  redis = getRedis(),
} = {}) {
  if (!LIVE_STATUSES.has(String(contest.status))) {
    throw new Error("Redis standings are only available for live contests");
  }

  const contestId = String(contest._id);
  const generation = await readGeneration(redis, contestId);
  const zsetKey = buildLeaderboardKey(contestId, generation);
  const membersKey = buildLeaderboardMembersKey(contestId, generation);
  const normalizedUserId = String(userId).toLowerCase();
  const member = await redis.hget(membersKey, normalizedUserId);
  if (!member) {
    throw new Error("Redis leaderboard participant metadata is missing");
  }

  const score = await redis.zscore(zsetKey, member);
  const zeroBasedRank = await redis.zrank(zsetKey, member);
  if (score == null || zeroBasedRank == null) {
    throw new Error("Redis leaderboard participant rank is missing");
  }

  const decoded = decodeParticipant({ score, member });
  if (decoded.userId !== normalizedUserId) {
    throw new Error("Redis leaderboard participant identity is inconsistent");
  }

  await assertGenerationUnchanged(redis, contestId, generation);
  return formatStanding({
    contest,
    participant: decoded,
    rank: zeroBasedRank + 1,
  });
}

function createStandingsReader({ redis } = {}) {
  return {
    readRedisStandings: (options = {}) =>
      readRedisStandings({ ...options, redis: options.redis || redis || getRedis() }),
    readRedisMyStanding: (options = {}) =>
      readRedisMyStanding({ ...options, redis: options.redis || redis || getRedis() }),
  };
}

module.exports = {
  MAX_PAGE_LIMIT,
  LIVE_STATUSES,
  closeRedis,
  createStandingsReader,
  formatStanding,
  paginationResult,
  readRedisStandings,
  readRedisMyStanding,
};
