let projectionEnqueuer = null;
const { createLogger } = require("../logger");
const logger = createLogger("shared.leaderboard");

function setLeaderboardProjectionEnqueuer(enqueuer) {
  if (enqueuer !== null && typeof enqueuer !== "function") {
    throw new TypeError("projection enqueuer must be a function or null");
  }
  projectionEnqueuer = enqueuer;
}

async function enqueueLeaderboardProjectionIfConfigured({ contestId, userId }) {
  if (!projectionEnqueuer) {
    return { enqueued: false, reason: "not_configured" };
  }

  try {
    await projectionEnqueuer({ contestId, userId });
    return { enqueued: true };
  } catch (error) {
    logger.error({
      event: "leaderboard_projection_enqueue_failed",
      contestId: String(contestId),
      userId: String(userId),
      err: error,
    });
    return { enqueued: false, reason: "enqueue_failed", error };
  }
}

module.exports = {
  setLeaderboardProjectionEnqueuer,
  enqueueLeaderboardProjectionIfConfigured,
};
