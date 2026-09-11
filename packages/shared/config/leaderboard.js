const {
  normalizeContestId,
  normalizeGeneration,
  normalizeObjectId,
} = require("../leaderboard/leaderboardEncoding");

const LEADERBOARD_KEY_PREFIX = "koder:v1";

const LEADERBOARD_META_STATE = Object.freeze({
  READY: "ready",
  REBUILDING: "rebuilding",
});

const LEADERBOARD_HEALTH = Object.freeze({
  HEALTHY: "healthy",
  ERROR: "error",
});

const LEADERBOARD_METADATA_FIELDS = Object.freeze({
  STATE: "state",
  GENERATION: "generation",
  REBUILD_ID: "rebuildId",
  STARTED_AT: "startedAt",
  FINISHED_AT: "finishedAt",
  PARTICIPANT_COUNT: "participantCount",
  LAST_SUCCESSFUL_REFRESH_AT: "lastSuccessfulRefreshAt",
  LAST_REBUILD_ID: "lastRebuildId",
  HEALTH: "health",
  ERROR: "error",
});

const LEADERBOARD_OPERATIONAL_DEFAULTS = Object.freeze({
  preseedEnabled: false,
  snapshotIntervalMs: 60 * 1000,
  endedRetentionMs: 24 * 60 * 60 * 1000,
  finalizedCleanupEnabled: false,
  finalizedCleanupGraceMs: 7 * 24 * 60 * 60 * 1000,
  cleanupContestBatchSize: 25,
  cleanupKeyScanCount: 100,
});

function parseNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function getLeaderboardOperationalConfig(env = process.env) {
  return {
    preseedEnabled: parseBoolean(env.KODER_LEADERBOARD_PRESEED_ENABLED, LEADERBOARD_OPERATIONAL_DEFAULTS.preseedEnabled),
    snapshotIntervalMs: parsePositiveInt(env.KODER_LEADERBOARD_SNAPSHOT_INTERVAL_MS, LEADERBOARD_OPERATIONAL_DEFAULTS.snapshotIntervalMs),
    endedRetentionMs: parseNonNegativeInt(env.KODER_LEADERBOARD_ENDED_RETENTION_MS, LEADERBOARD_OPERATIONAL_DEFAULTS.endedRetentionMs),
    finalizedCleanupEnabled: parseBoolean(env.KODER_LEADERBOARD_FINALIZED_CLEANUP_ENABLED, LEADERBOARD_OPERATIONAL_DEFAULTS.finalizedCleanupEnabled),
    finalizedCleanupGraceMs: parseNonNegativeInt(env.KODER_LEADERBOARD_FINALIZED_CLEANUP_GRACE_MS, LEADERBOARD_OPERATIONAL_DEFAULTS.finalizedCleanupGraceMs),
    cleanupContestBatchSize: parsePositiveInt(env.KODER_LEADERBOARD_CLEANUP_CONTEST_BATCH_SIZE, LEADERBOARD_OPERATIONAL_DEFAULTS.cleanupContestBatchSize),
    cleanupKeyScanCount: parsePositiveInt(env.KODER_LEADERBOARD_CLEANUP_KEY_SCAN_COUNT, LEADERBOARD_OPERATIONAL_DEFAULTS.cleanupKeyScanCount),
  };
}

function buildLeaderboardBaseKey(contestId, generation) {
  return `${LEADERBOARD_KEY_PREFIX}:contest:${normalizeContestId(contestId)}:leaderboard:${normalizeGeneration(generation)}`;
}

function buildLeaderboardKey(contestId, generation) {
  return buildLeaderboardBaseKey(contestId, generation);
}

function buildLeaderboardMembersKey(contestId, generation) {
  return `${buildLeaderboardBaseKey(contestId, generation)}:members`;
}

function buildLeaderboardMetaKey(contestId, generation) {
  return `${buildLeaderboardBaseKey(contestId, generation)}:meta`;
}

function buildLeaderboardActiveVersionKey(contestId) {
  return `${LEADERBOARD_KEY_PREFIX}:contest:${normalizeContestId(contestId)}:leaderboard:activeVersion`;
}

function buildLeaderboardRebuildLockKey(contestId) {
  return `${LEADERBOARD_KEY_PREFIX}:contest:${normalizeContestId(contestId)}:leaderboard:rebuildLock`;
}

function buildLeaderboardSweepLockKey() {
  return `${LEADERBOARD_KEY_PREFIX}:leaderboard:sweepLock`;
}

function buildLeaderboardGenerationPattern(contestId) {
  return `${LEADERBOARD_KEY_PREFIX}:contest:${normalizeContestId(contestId)}:leaderboard:generation-*`;
}

function buildLeaderboardProjectionPayload({ contestId, userId }) {
  return {
    contestId: normalizeContestId(contestId),
    userId: normalizeObjectId(userId),
  };
}

module.exports = {
  LEADERBOARD_KEY_PREFIX,
  LEADERBOARD_META_STATE,
  LEADERBOARD_HEALTH,
  LEADERBOARD_METADATA_FIELDS,
  LEADERBOARD_OPERATIONAL_DEFAULTS,
  getLeaderboardOperationalConfig,
  buildLeaderboardKey,
  buildLeaderboardMembersKey,
  buildLeaderboardMetaKey,
  buildLeaderboardActiveVersionKey,
  buildLeaderboardRebuildLockKey,
  buildLeaderboardSweepLockKey,
  buildLeaderboardGenerationPattern,
  buildLeaderboardProjectionPayload,
};
