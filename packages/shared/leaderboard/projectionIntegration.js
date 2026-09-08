let projectionEnqueuer = null;

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
    console.error(
      `Leaderboard projection enqueue failed for contest ${contestId}, user ${userId}:`,
      error?.message || error,
    );
    return { enqueued: false, reason: "enqueue_failed", error };
  }
}

module.exports = {
  setLeaderboardProjectionEnqueuer,
  enqueueLeaderboardProjectionIfConfigured,
};
