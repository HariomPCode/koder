const Contest = require("../models/Contest");
const {
  CONTEST_STATUS,
  getNextContestLifecycleStatus,
} = require("../services/contestLifecycle");
const { createLogger } = require("@koder/shared");
const defaultLogger = createLogger("backend.contest_scheduler");

const CONTEST_SCHEDULER_INTERVAL_MS = 5 * 1000;
const SCHEDULABLE_STATUSES = [
  CONTEST_STATUS.SCHEDULED,
  CONTEST_STATUS.REGISTRATION,
  CONTEST_STATUS.RUNNING,
];

function createContestSchedulerRunner({
  ContestModel = Contest,
  now = () => Date.now(),
  logger = defaultLogger,
} = {}) {
  if (!ContestModel || typeof ContestModel.find !== "function") {
    throw new TypeError("ContestModel.find is required");
  }

  return async function runContestScheduler() {
    const contests = await ContestModel.find({
      status: { $in: SCHEDULABLE_STATUSES },
    }).lean();
    const result = {
      scanned: contests.length,
      transitioned: 0,
      failed: 0,
    };

    for (const contest of contests) {
      const nextStatus = getNextContestLifecycleStatus(contest, now());
      if (!nextStatus || nextStatus === contest.status) {
        continue;
      }

      try {
        const updateResult = await ContestModel.updateOne(
          { _id: contest._id, status: contest.status },
          { $set: { status: nextStatus } },
        );
        const modified = updateResult?.modifiedCount ?? updateResult?.nModified ?? 0;
        if (modified === 1) {
          result.transitioned += 1;
        }
      } catch (error) {
        result.failed += 1;
        logger.error({
          event: "contest_lifecycle_transition_failed",
          contestId: String(contest._id),
          err: error,
        });
      }
    }

    return result;
  };
}

function startContestScheduler({
  intervalMs = CONTEST_SCHEDULER_INTERVAL_MS,
  runner = null,
} = {}) {
  const run = runner || createContestSchedulerRunner();
  const timer = setInterval(() => {
    run().catch((error) => {
      defaultLogger.error({ event: "contest_lifecycle_sweep_failed", err: error });
    });
  }, intervalMs);
  timer.unref?.();
  run().catch((error) => {
    defaultLogger.error({ event: "contest_startup_lifecycle_sweep_failed", err: error });
  });

  return {
    timer,
    async stop() {
      clearInterval(timer);
    },
  };
}

module.exports = {
  CONTEST_SCHEDULER_INTERVAL_MS,
  SCHEDULABLE_STATUSES,
  createContestSchedulerRunner,
  startContestScheduler,
};
