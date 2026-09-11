const Contest = require("../models/Contest");
const {
  CONTEST_STATUS,
  getNextContestLifecycleStatus,
} = require("../services/contestLifecycle");

const CONTEST_SCHEDULER_INTERVAL_MS = 5 * 1000;
const SCHEDULABLE_STATUSES = [
  CONTEST_STATUS.SCHEDULED,
  CONTEST_STATUS.REGISTRATION,
  CONTEST_STATUS.RUNNING,
];

function createContestSchedulerRunner({
  ContestModel = Contest,
  now = () => Date.now(),
  logger = console,
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
        logger.error(
          `Contest lifecycle transition failed for ${contest._id}:`,
          error?.message || error,
        );
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
      console.error("Contest lifecycle scheduler failed:", error?.message || error);
    });
  }, intervalMs);
  timer.unref?.();
  run().catch((error) => {
    console.error("Contest startup lifecycle sweep failed:", error?.message || error);
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
