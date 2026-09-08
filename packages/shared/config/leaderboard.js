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
  buildLeaderboardKey,
  buildLeaderboardMembersKey,
  buildLeaderboardMetaKey,
  buildLeaderboardActiveVersionKey,
  buildLeaderboardRebuildLockKey,
  buildLeaderboardSweepLockKey,
  buildLeaderboardProjectionPayload,
};
