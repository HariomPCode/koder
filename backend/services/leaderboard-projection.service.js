const crypto = require("crypto");
const {
  Contest,
  ContestParticipant,
  buildLeaderboardActiveVersionKey,
  buildLeaderboardKey,
  buildLeaderboardMembersKey,
  buildLeaderboardMetaKey,
  buildLeaderboardProjectionPayload,
  buildLeaderboardRebuildLockKey,
  encodeParticipant,
  normalizeContestId,
  LEADERBOARD_HEALTH,
  LEADERBOARD_META_STATE,
  LEADERBOARD_METADATA_FIELDS,
} = require("@koder/shared");
const LeaderboardRepository = require("../repositories/leaderboard.repository");

const LIVE_STATUSES = new Set(["RUNNING", "ENDED"]);
const DEFAULT_BATCH_SIZE = 250;
const LOCK_TTL_MS = 15 * 60 * 1000;

const PUBLISH_VERSION_SCRIPT = `
local state = redis.call("HGET", KEYS[2], "state")
local health = redis.call("HGET", KEYS[2], "health")
if state ~= "ready" or health ~= "healthy" then
  return 0
end
redis.call("SET", KEYS[1], ARGV[1])
return 1
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function createRebuildId(uuid = crypto.randomUUID) {
  return `rebuild-${uuid()}`;
}

function createGeneration(rebuildId) {
  return `generation-${rebuildId}`;
}

function createLeaderboardProjectionService({
  ContestModel = Contest,
  ParticipantModel = ContestParticipant,
  redis,
  enqueueProjection = null,
  repository = new LeaderboardRepository({ participantModel: ParticipantModel }),
  now = () => Date.now(),
  uuid = crypto.randomUUID,
  batchSize = DEFAULT_BATCH_SIZE,
} = {}) {
  if (!redis) {
    throw new TypeError("redis connection is required");
  }

  async function releaseLock(lockKey, lockToken) {
    await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockToken);
  }

  async function rebuildContest(contestId, { actorUserId = null, reason = "operational recovery" } = {}) {
    const normalizedContestId = normalizeContestId(contestId);
    const contest = await ContestModel.findById(normalizedContestId).lean();
    if (!contest) {
      const error = new Error("Contest not found");
      error.statusCode = 404;
      throw error;
    }

    const lockKey = buildLeaderboardRebuildLockKey(normalizedContestId);
    const lockToken = `${process.pid}:${uuid()}`;
    const acquired = await redis.set(lockKey, lockToken, "PX", LOCK_TTL_MS, "NX");
    if (acquired !== "OK") {
      return {
        status: "already_running",
        contestId: normalizedContestId,
      };
    }

    const rebuildId = createRebuildId(uuid);
    const generation = createGeneration(rebuildId);
    const metaKey = buildLeaderboardMetaKey(normalizedContestId, generation);
    const zsetKey = buildLeaderboardKey(normalizedContestId, generation);
    const membersKey = buildLeaderboardMembersKey(normalizedContestId, generation);
    const activeVersionKey = buildLeaderboardActiveVersionKey(normalizedContestId);
    const startedAt = String(now());
    let participantCount = 0;
    const previousGeneration = await redis.get(activeVersionKey);

    try {
      await redis.hset(metaKey, {
        [LEADERBOARD_METADATA_FIELDS.STATE]: LEADERBOARD_META_STATE.REBUILDING,
        [LEADERBOARD_METADATA_FIELDS.HEALTH]: LEADERBOARD_HEALTH.ERROR,
        [LEADERBOARD_METADATA_FIELDS.GENERATION]: generation,
        [LEADERBOARD_METADATA_FIELDS.REBUILD_ID]: rebuildId,
        [LEADERBOARD_METADATA_FIELDS.STARTED_AT]: startedAt,
        [LEADERBOARD_METADATA_FIELDS.ERROR]: "",
        actorUserId: actorUserId ? String(actorUserId) : "",
        reason: String(reason || ""),
      });

      const pipeline = () => redis.pipeline();
      let batch = [];
      const flush = async () => {
        if (batch.length === 0) return;
        const commands = pipeline();
        for (const participant of batch) {
          const { score, member } = encodeParticipant(participant);
          const userId = String(participant.userId).toLowerCase();
          commands.zadd(zsetKey, score, member);
          commands.hset(membersKey, userId, member);
        }
        await commands.exec();
        if (typeof redis.pexpire === "function") {
          await redis.pexpire(lockKey, LOCK_TTL_MS);
        }
        participantCount += batch.length;
        batch = [];
      };

      const cursor = repository.cursorParticipants(normalizedContestId);
      for await (const participant of cursor) {
        batch.push(participant);
        if (batch.length >= batchSize) {
          await flush();
        }
      }
      await flush();

      const [zsetCount, memberCount] = await Promise.all([
        redis.zcard(zsetKey),
        redis.hlen(membersKey),
      ]);
      if (Number(zsetCount) !== participantCount || Number(memberCount) !== participantCount) {
        throw new Error(
          `Rebuild validation failed: expected ${participantCount}, zset=${zsetCount}, members=${memberCount}`,
        );
      }

      await redis.hset(metaKey, {
        [LEADERBOARD_METADATA_FIELDS.STATE]: LEADERBOARD_META_STATE.READY,
        [LEADERBOARD_METADATA_FIELDS.HEALTH]: LEADERBOARD_HEALTH.HEALTHY,
        [LEADERBOARD_METADATA_FIELDS.PARTICIPANT_COUNT]: String(participantCount),
        [LEADERBOARD_METADATA_FIELDS.FINISHED_AT]: String(now()),
        [LEADERBOARD_METADATA_FIELDS.LAST_SUCCESSFUL_REFRESH_AT]: String(now()),
        [LEADERBOARD_METADATA_FIELDS.LAST_REBUILD_ID]: rebuildId,
        [LEADERBOARD_METADATA_FIELDS.ERROR]: "",
      });

      const published = await redis.eval(
        PUBLISH_VERSION_SCRIPT,
        2,
        activeVersionKey,
        metaKey,
        generation,
      );
      if (Number(published) !== 1) {
        throw new Error("Rebuild publication refused because generation is not ready");
      }

      if (previousGeneration && previousGeneration !== generation) {
        await redis.del(
          buildLeaderboardKey(normalizedContestId, previousGeneration),
          buildLeaderboardMembersKey(normalizedContestId, previousGeneration),
          buildLeaderboardMetaKey(normalizedContestId, previousGeneration),
        );
      }

      return {
        status: "published",
        contestId: normalizedContestId,
        generation,
        rebuildId,
        participantCount,
        contestStatus: contest.status,
      };
    } catch (error) {
      await redis.hset(metaKey, {
        [LEADERBOARD_METADATA_FIELDS.STATE]: LEADERBOARD_META_STATE.REBUILDING,
        [LEADERBOARD_METADATA_FIELDS.HEALTH]: LEADERBOARD_HEALTH.ERROR,
        [LEADERBOARD_METADATA_FIELDS.ERROR]: error.message,
        [LEADERBOARD_METADATA_FIELDS.FINISHED_AT]: String(now()),
      }).catch(() => {});
      throw error;
    } finally {
      await releaseLock(lockKey, lockToken).catch(() => {});
    }
  }

  async function checkDrift(contestId, { limit = Infinity } = {}) {
    const normalizedContestId = normalizeContestId(contestId);
    const generation = await redis.get(buildLeaderboardActiveVersionKey(normalizedContestId));
    if (!generation) {
      return { drifted: true, reason: "active_version_missing", checked: 0 };
    }
    const metaKey = buildLeaderboardMetaKey(normalizedContestId, generation);
    const meta = await redis.hgetall(metaKey);
    if (meta.state !== LEADERBOARD_META_STATE.READY || meta.health !== LEADERBOARD_HEALTH.HEALTHY) {
      return { drifted: true, reason: "projection_unhealthy", generation, checked: 0 };
    }

    const expectedCount = await repository.countParticipants(normalizedContestId);
    const actualCount = Number(await redis.zcard(buildLeaderboardKey(normalizedContestId, generation)));
    if (expectedCount !== actualCount) {
      return { drifted: true, reason: "count_mismatch", generation, expectedCount, actualCount, checked: 0 };
    }

    let checked = 0;
    const cursor = repository.cursorParticipants(normalizedContestId);
    for await (const participant of cursor) {
      if (checked >= limit) break;
      const expected = encodeParticipant(participant);
      const actualMember = await redis.hget(
        buildLeaderboardMembersKey(normalizedContestId, generation),
        String(participant.userId).toLowerCase(),
      );
      const actualScore = await redis.zscore(
        buildLeaderboardKey(normalizedContestId, generation),
        actualMember || "",
      );
      checked += 1;
      if (actualMember !== expected.member || Number(actualScore) !== expected.score) {
        return { drifted: true, reason: "participant_mismatch", generation, checked, userId: String(participant.userId) };
      }
    }
    return { drifted: false, generation, checked, expectedCount, actualCount };
  }

  async function sweepContest(contestId, { limit = Infinity } = {}) {
    const normalizedContestId = normalizeContestId(contestId);
    const contest = await ContestModel.findById(normalizedContestId).lean();
    if (!contest || !LIVE_STATUSES.has(contest.status)) {
      return { contestId: normalizedContestId, enqueued: 0, skipped: "not_live" };
    }
    const generation = await redis.get(buildLeaderboardActiveVersionKey(normalizedContestId));
    if (!generation) {
      return { ...(await rebuildContest(normalizedContestId)), enqueued: 0, rebuilt: true };
    }
    const meta = await redis.hgetall(buildLeaderboardMetaKey(normalizedContestId, generation));
    if (meta.state !== LEADERBOARD_META_STATE.READY || meta.health !== LEADERBOARD_HEALTH.HEALTHY) {
      return { ...(await rebuildContest(normalizedContestId)), enqueued: 0, rebuilt: true };
    }
    const since = Number(meta.lastSuccessfulRefreshAt || 0);
    let enqueued = 0;
    const cursor = repository.cursorParticipants(normalizedContestId);
    for await (const participant of cursor) {
      if (enqueued >= limit) break;
      const updatedAt = participant.updatedAt ? new Date(participant.updatedAt).getTime() : 0;
      if (updatedAt > since && enqueueProjection) {
        await enqueueProjection(buildLeaderboardProjectionPayload({
          contestId: normalizedContestId,
          userId: participant.userId,
        }));
        enqueued += 1;
      }
    }
    return { contestId: normalizedContestId, generation, enqueued };
  }

  async function sweepLiveProjections({ limitPerContest = Infinity } = {}) {
    const results = [];
    const cursor = ContestModel.find({ status: { $in: [...LIVE_STATUSES] } })
      .select({ _id: 1 })
      .lean()
      .cursor();
    for await (const contest of cursor) {
      results.push(await sweepContest(contest._id, { limit: limitPerContest }));
    }
    return results;
  }

  return { rebuildContest, checkDrift, sweepContest, sweepLiveProjections };
}

module.exports = {
  PUBLISH_VERSION_SCRIPT,
  RELEASE_LOCK_SCRIPT,
  createLeaderboardProjectionService,
  createGeneration,
  createRebuildId,
};
