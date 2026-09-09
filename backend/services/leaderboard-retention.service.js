const {
  Contest,
  LEADERBOARD_KEY_PREFIX,
  buildLeaderboardActiveVersionKey,
  buildLeaderboardGenerationPattern,
  buildLeaderboardRebuildLockKey,
  getLeaderboardOperationalConfig,
  normalizeContestId,
} = require("@koder/shared");

const CLEANUP_LOCK_TTL_MS = 15 * 60 * 1000;
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function generationFromKey(contestId, key) {
  const prefix = `${LEADERBOARD_KEY_PREFIX}:contest:${contestId}:leaderboard:`;
  if (!key.startsWith(prefix)) return null;
  const suffix = key.slice(prefix.length);
  if (!suffix.startsWith("generation-")) return null;
  if (suffix.endsWith(":members")) return suffix.slice(0, -":members".length);
  if (suffix.endsWith(":meta")) return suffix.slice(0, -":meta".length);
  return suffix;
}

function createLeaderboardRetentionService({
  ContestModel = Contest,
  redis,
  projectionService = null,
  config = getLeaderboardOperationalConfig(),
  now = () => Date.now(),
} = {}) {
  if (!redis) throw new TypeError("redis connection is required");

  async function releaseLock(lockKey, token) {
    await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
  }

  async function scanGenerationKeys(contestId) {
    const keys = [];
    const pattern = buildLeaderboardGenerationPattern(contestId);
    let cursor = "0";
    do {
      const result = await redis.scan(cursor, "MATCH", pattern, "COUNT", config.cleanupKeyScanCount);
      cursor = String(result[0]);
      keys.push(...result[1]);
    } while (cursor !== "0");
    return keys;
  }

  async function cleanupContest(contestId, { force = false, reason = "scheduled retention cleanup" } = {}) {
    const normalizedContestId = normalizeContestId(contestId);
    const contest = await ContestModel.findById(normalizedContestId).lean();
    if (!contest) return { contestId: normalizedContestId, status: "not_found" };

    const contestStatus = String(contest.status);
    if (contestStatus === "FINALIZED" && !config.finalizedCleanupEnabled && !force) {
      return { contestId: normalizedContestId, status: "disabled", reason: "finalized_cleanup_disabled" };
    }
    const endedAt = contest.endTime ? new Date(contest.endTime).getTime() : null;
    const updatedAt = contest.updatedAt ? new Date(contest.updatedAt).getTime() : null;
    const due =
      force ||
      (contestStatus === "ENDED" &&
        endedAt != null &&
        now() >= endedAt + config.endedRetentionMs) ||
      (contestStatus === "FINALIZED" &&
        config.finalizedCleanupEnabled &&
        updatedAt != null &&
        now() >= updatedAt + config.finalizedCleanupGraceMs);

    if (!due) {
      return { contestId: normalizedContestId, status: "not_due", contestStatus };
    }
    if (contestStatus !== "ENDED" && contestStatus !== "FINALIZED") {
      return { contestId: normalizedContestId, status: "skipped", reason: "contest_not_ended_or_finalized" };
    }
    const lockKey = buildLeaderboardRebuildLockKey(normalizedContestId);
    const lockToken = `${process.pid}:${now()}:${Math.random()}`;
    if ((await redis.set(lockKey, lockToken, "PX", CLEANUP_LOCK_TTL_MS, "NX")) !== "OK") {
      return { contestId: normalizedContestId, status: "already_running" };
    }

    try {
      const activeVersionKey = buildLeaderboardActiveVersionKey(normalizedContestId);
      const activeGeneration = await redis.get(activeVersionKey);
      const keys = await scanGenerationKeys(normalizedContestId);
      const generations = new Map();
      for (const key of keys) {
        const generation = generationFromKey(normalizedContestId, key);
        if (!generation) continue;
        if (!generations.has(generation)) generations.set(generation, []);
        generations.get(generation).push(key);
      }

      const deletions = [];
      const completeGenerations = new Set();
      for (const [generation, generationKeys] of generations) {
        if (generationKeys.length === 3) completeGenerations.add(generation);
      }
      const removeActive = contestStatus === "FINALIZED" || contestStatus === "ENDED";
      for (const [generation, generationKeys] of generations) {
        if (!completeGenerations.has(generation)) continue;
        if (!removeActive && generation === activeGeneration) continue;
        deletions.push(...generationKeys);
      }
      if (removeActive && activeGeneration && completeGenerations.has(activeGeneration)) {
        deletions.push(activeVersionKey);
      }

      if (deletions.length > 0) {
        await redis.del(...deletions);
      }

      return {
        contestId: normalizedContestId,
        status: "cleaned",
        contestStatus,
        activeGeneration,
        deletedKeys: deletions.length,
        reason,
      };
    } finally {
      await releaseLock(lockKey, lockToken).catch(() => {});
    }
  }

  async function cleanupDueContests({ limit = config.cleanupContestBatchSize } = {}) {
    const contests = await ContestModel.find({
      status: { $in: ["ENDED", "FINALIZED"] },
    })
      .select({ _id: 1 })
      .sort({ endTime: 1 })
      .limit(limit)
      .lean();
    const results = [];
    for (const contest of contests) {
      results.push(await cleanupContest(contest._id));
    }
    return results;
  }

  async function preseedContest(contestId, options = {}) {
    if (!config.preseedEnabled && !options.force) {
      return { contestId: normalizeContestId(contestId), status: "disabled" };
    }
    if (!projectionService) {
      throw new Error("projection service is required for pre-seeding");
    }
    const normalizedContestId = normalizeContestId(contestId);
    const contest = await ContestModel.findById(normalizedContestId).lean();
    if (!contest) return { contestId: normalizedContestId, status: "not_found" };
    if (!["RUNNING", "ENDED"].includes(String(contest.status))) {
      return { contestId: normalizedContestId, status: "skipped", reason: "contest_not_live" };
    }
    return projectionService.rebuildContest(normalizedContestId, {
      actorUserId: options.actorUserId || null,
      reason: options.reason || "optional participant pre-seed",
    });
  }

  return {
    cleanupContest,
    cleanupDueContests,
    preseedContest,
  };
}

module.exports = {
  createLeaderboardRetentionService,
  generationFromKey,
};
