const {
  Contest,
  ContestParticipant,
  buildLeaderboardActiveVersionKey,
  buildLeaderboardKey,
  buildLeaderboardMembersKey,
  buildLeaderboardMetaKey,
  encodeParticipant,
  normalizeContestId,
  normalizeObjectId,
  createLogger,
} = require("@koder/shared");
const logger = createLogger("worker.leaderboard_projection");

const LIVE_CONTEST_STATUSES = new Set(["RUNNING", "ENDED"]);

const APPLY_PROJECTION_SCRIPT = `
local oldMember = ARGV[1]
local newMember = ARGV[2]
local score = ARGV[3]
local userId = ARGV[4]
local refreshedAt = ARGV[5]

if oldMember ~= "" and oldMember ~= newMember then
  redis.call("ZREM", KEYS[1], oldMember)
end
redis.call("ZADD", KEYS[1], score, newMember)
redis.call("HSET", KEYS[2], userId, newMember)
redis.call(
  "HSET",
  KEYS[3],
  "lastSuccessfulRefreshAt",
  refreshedAt,
  "health",
  "healthy",
  "error",
  ""
)
return 1
`;

function projectionResult(reason, extra = {}) {
  return {
    processed: false,
    reason,
    ...extra,
  };
}

function createProjectionProcessor({
  ContestModel = Contest,
  ContestParticipantModel = ContestParticipant,
  redis,
  now = () => Date.now(),
} = {}) {
  if (!redis) {
    throw new TypeError("redis connection is required");
  }

  return async function processProjectionJob(job) {
    const payload = job?.data || {};
    const contestId = normalizeContestId(payload.contestId);
    const userId = normalizeObjectId(payload.userId);

    const contest = await ContestModel.findById(contestId).lean();
    if (!contest) {
      return projectionResult("contest_not_found", { contestId, userId });
    }
    if (!LIVE_CONTEST_STATUSES.has(contest.status)) {
      return projectionResult("contest_not_live", {
        contestId,
        userId,
        contestStatus: contest.status,
      });
    }

    const participant = await ContestParticipantModel.findOne({
      contestId,
      userId,
    }).lean();
    if (!participant) {
      return projectionResult("participant_not_found", { contestId, userId });
    }

    const activeVersionKey = buildLeaderboardActiveVersionKey(contestId);
    const generation = await redis.get(activeVersionKey);
    if (!generation) {
      return projectionResult("active_version_missing", { contestId, userId });
    }

    const zsetKey = buildLeaderboardKey(contestId, generation);
    const membersKey = buildLeaderboardMembersKey(contestId, generation);
    const metaKey = buildLeaderboardMetaKey(contestId, generation);
    const metaState = await redis.hget(metaKey, "state");
    const metaHealth = await redis.hget(metaKey, "health");
    if (metaState !== "ready") {
      return projectionResult("projection_not_ready", { contestId, userId, generation });
    }
    if (metaHealth !== "healthy") {
      return projectionResult("projection_unhealthy", { contestId, userId, generation });
    }

    const { score, member } = encodeParticipant(participant);
    const previousMember = (await redis.hget(membersKey, userId)) || "";
    await redis.eval(
      APPLY_PROJECTION_SCRIPT,
      3,
      zsetKey,
      membersKey,
      metaKey,
      previousMember,
      member,
      String(score),
      userId,
      String(now()),
    );

    logger.info({
      event: "leaderboard_projection_refreshed",
      contestId,
      userId,
      generation,
    });
    return {
      processed: true,
      contestId,
      userId,
      generation,
      score,
      member,
    };
  };
}

module.exports = {
  APPLY_PROJECTION_SCRIPT,
  LIVE_CONTEST_STATUSES,
  createProjectionProcessor,
};
