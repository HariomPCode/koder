const IoRedis = require("ioredis");
const {
  Contest,
  ContestParticipant,
  ContestLeaderboardSnapshot,
  assignCompetitionRanks,
  getRedisConfig,
  getLeaderboardOperationalConfig,
} = require("@koder/shared");
const { createLeaderboardProjectionService } = require("./leaderboard-projection.service");
const { CONTEST_STATUS } = require("./contestLifecycle");
const { createLogger } = require("@koder/shared");

const logger = createLogger("backend.contest_leaderboard_lifecycle");

function buildStandings(contest, participants) {
  return assignCompetitionRanks(participants).map((participant) => {
    const solvedCount = participant.solvedCount || 0;
    const lastAcceptedAt =
      solvedCount > 0 && participant.lastAcceptedContestMs != null
        ? new Date(new Date(contest.startTime).getTime() + participant.lastAcceptedContestMs)
        : null;

    return {
      userId: participant.userId,
      rank: participant.rank,
      solvedCount,
      score: solvedCount,
      penalty: participant.totalPenalty || 0,
      ...(lastAcceptedAt ? { lastAcceptedAt } : {}),
    };
  });
}

function createContestLeaderboardLifecycle({
  ContestModel = Contest,
  ParticipantModel = ContestParticipant,
  SnapshotModel = ContestLeaderboardSnapshot,
  projectionService = null,
  redis = null,
  distributedSnapshotLock = false,
  intervalMs = getLeaderboardOperationalConfig().snapshotIntervalMs,
  logger: lifecycleLogger = logger,
} = {}) {
  let redisConnection = redis;
  let projection = projectionService;
  const inFlightSnapshots = new Set();
  let schedulerHandle = null;
  const snapshotLockTtlMs = Math.max(intervalMs * 2, 30_000);

  function getProjection() {
    if (!redisConnection) {
      redisConnection = new IoRedis(getRedisConfig());
    }
    if (!projection) {
      projection = createLeaderboardProjectionService({
        ContestModel,
        ParticipantModel,
        redis: redisConnection,
      });
    }
    return projection;
  }

  async function acquireSnapshotLock(contestId) {
    if (!distributedSnapshotLock) return null;
    if (!redisConnection) {
      redisConnection = new IoRedis(getRedisConfig());
    }
    const token = `${process.pid}-${Date.now()}-${Math.random()}`;
    const key = `koder:contest-snapshot-lock:${String(contestId)}`;
    const acquired = await redisConnection.set(
      key,
      token,
      "NX",
      "PX",
      snapshotLockTtlMs,
    );
    return acquired === "OK" ? { key, token } : false;
  }

  async function releaseSnapshotLock(lock) {
    if (!lock || !redisConnection) return;
    await redisConnection.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lock.key,
      lock.token,
    );
  }

  async function snapshotContest(contestId, { isFinal = false } = {}) {
    const contest = await ContestModel.findById(contestId).lean();
    if (!contest || (!isFinal && contest.status !== CONTEST_STATUS.RUNNING)) {
      return { status: "skipped", reason: "contest_not_running" };
    }

    const participants = await ParticipantModel.find({ contestId }).sort({
      solvedCount: -1,
      totalPenalty: 1,
      lastAcceptedContestMs: 1,
      userId: 1,
    }).lean();

    const snapshot = await SnapshotModel.create({
      contestId: contest._id,
      takenAt: new Date(),
      isFinal,
      standings: buildStandings(contest, participants),
    });
    if (!isFinal) {
      const currentState = await ContestModel.findById(contestId).select({ status: 1 }).lean();
      if (!currentState || currentState.status !== CONTEST_STATUS.RUNNING) {
        if (typeof SnapshotModel.deleteOne === "function") {
          await SnapshotModel.deleteOne({ _id: snapshot._id, isFinal: false });
        }
        return { status: "discarded", reason: "contest_left_running" };
      }
    }
    return { status: "created", snapshot };
  }

  async function snapshotRunningContest(contestId) {
    const key = String(contestId);
    if (inFlightSnapshots.has(key)) {
      return { status: "already_running", contestId: key };
    }
    const lock = await acquireSnapshotLock(contestId);
    if (lock === false) {
      return { status: "already_running", contestId: key };
    }
    inFlightSnapshots.add(key);
    try {
      return await snapshotContest(contestId);
    } finally {
      inFlightSnapshots.delete(key);
      await releaseSnapshotLock(lock).catch(() => {});
    }
  }

  async function snapshotRunningContests() {
    const contests = await ContestModel.find({ status: CONTEST_STATUS.RUNNING })
      .select({ _id: 1 })
      .lean();
    const results = [];
    for (const contest of contests) {
      try {
        results.push(await snapshotRunningContest(contest._id));
      } catch (error) {
        lifecycleLogger.warn({
          event: "contest_snapshot_failed",
          contestId: String(contest._id),
          err: error,
        });
      }
    }
    return results;
  }

  async function preseedContest(contestId) {
    try {
      return await getProjection().rebuildContest(contestId, {
        reason: "automatic running-transition pre-seed",
      });
    } catch (error) {
      lifecycleLogger.warn({
        event: "contest_leaderboard_preseed_failed",
        contestId: String(contestId),
        err: error,
      });
      return { status: "failed", contestId: String(contestId) };
    }
  }

  function start() {
    if (schedulerHandle) return schedulerHandle;
    snapshotRunningContests().catch((error) => {
      lifecycleLogger.warn({ event: "contest_snapshot_startup_sweep_failed", err: error });
    });
    const timer = setInterval(() => {
      snapshotRunningContests().catch((error) => {
        lifecycleLogger.warn({ event: "contest_snapshot_sweep_failed", err: error });
      });
    }, intervalMs);
    timer.unref?.();
    schedulerHandle = {
      timer,
      stop: () => {
        clearInterval(timer);
        schedulerHandle = null;
      },
    };
    return schedulerHandle;
  }

  return {
    buildStandings,
    snapshotContest,
    snapshotRunningContest,
    snapshotRunningContests,
    preseedContest,
    start,
    getProjection,
  };
}

module.exports = {
  buildStandings,
  createContestLeaderboardLifecycle,
};
