const IoRedis = require("ioredis");
const { Queue } = require("bullmq");
const {
  LEADERBOARD_PROJECTION_QUEUE_NAME,
  LEADERBOARD_PROJECTION_JOB_NAME,
  buildLeaderboardProjectionPayload,
  createQueueJobOptions,
  getRedisConfig,
} = require("@koder/shared");
const { createLogger } = require("@koder/shared");
const logger = createLogger("backend.leaderboard_queue");

let connection = null;
let queue = null;
const ENQUEUE_TIMEOUT_MS = 1000;

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ENQUEUE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function getLeaderboardProjectionQueue() {
  if (!connection) {
    connection = new IoRedis(getRedisConfig());
  }
  if (!queue) {
    queue = new Queue(LEADERBOARD_PROJECTION_QUEUE_NAME, {
      connection,
      defaultJobOptions: createQueueJobOptions(),
    });
  }
  return queue;
}

async function enqueueLeaderboardProjection({ contestId, userId }) {
  const payload = buildLeaderboardProjectionPayload({ contestId, userId });
  const job = await withTimeout(
    getLeaderboardProjectionQueue().add(
      LEADERBOARD_PROJECTION_JOB_NAME,
      payload,
      createQueueJobOptions(),
    ),
    "Leaderboard projection enqueue",
  );
  logger.info({
    event: "leaderboard_projection_job_enqueued",
    contestId: payload.contestId,
    userId: payload.userId,
    jobId: String(job.id),
  });
  return job;
}

async function closeLeaderboardProjectionQueue() {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}

module.exports = {
  enqueueLeaderboardProjection,
  closeLeaderboardProjectionQueue,
  getLeaderboardProjectionQueue,
};
