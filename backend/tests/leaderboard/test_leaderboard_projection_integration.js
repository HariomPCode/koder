const assert = require("assert");
const {
  setLeaderboardProjectionEnqueuer,
  triggerContestScoring,
} = require("@koder/shared");

const contestId = "64e2d5ec5956e8d99d0f1234";
const userId = "000000000000000000000001";

async function runTests() {
  const jobs = [];
  setLeaderboardProjectionEnqueuer(async (payload) => {
    jobs.push(payload);
  });

  try {
    const contestSubmission = { contestId, userId };
    await triggerContestScoring("accepted", contestSubmission, {
      applyScoring: async () => ({ processed: true, projectionRequired: true }),
    });
    assert.deepStrictEqual(jobs, [{ contestId, userId }]);

    await triggerContestScoring("wrong", contestSubmission, {
      applyScoring: async () => ({ processed: true, projectionRequired: false }),
    });
    assert.strictEqual(jobs.length, 1);

    await triggerContestScoring("practice", { userId }, {
      applyScoring: async () => ({ processed: false, reason: "practice_submission" }),
    });
    assert.strictEqual(jobs.length, 1);

    let failureObserved = false;
    setLeaderboardProjectionEnqueuer(async () => {
      throw new Error("queue unavailable");
    });
    await triggerContestScoring("accepted-with-redis-down", contestSubmission, {
      applyScoring: async () => ({ processed: true, projectionRequired: true }),
      onProjectionFailure: () => {
        failureObserved = true;
      },
    });
    assert.strictEqual(failureObserved, true);
  } finally {
    setLeaderboardProjectionEnqueuer(null);
  }

  console.log("Leaderboard projection integration tests passed");
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
