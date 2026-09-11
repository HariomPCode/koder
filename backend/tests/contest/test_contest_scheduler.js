const assert = require("assert");
const {
  CONTEST_SCHEDULER_INTERVAL_MS,
  SCHEDULABLE_STATUSES,
  createContestSchedulerRunner,
} = require("../../jobs/contestScheduler");

function createContest(id, status, times) {
  return {
    _id: id,
    status,
    registrationOpenTime: times.registrationOpenTime,
    startTime: times.startTime,
    endTime: times.endTime,
  };
}

function createModel(contests, updateResults = {}) {
  const updates = [];
  return {
    updates,
    find(filter) {
      assert.deepStrictEqual(filter, { status: { $in: SCHEDULABLE_STATUSES } });
      return {
        lean: async () => contests,
      };
    },
    async updateOne(filter, update) {
      updates.push({ filter, update });
      return { modifiedCount: updateResults[filter._id] === false ? 0 : 1 };
    },
  };
}

async function runTests() {
  const now = Date.parse("2026-09-11T12:00:00.000Z");
  const contests = [
    createContest("registration", "SCHEDULED", {
      registrationOpenTime: new Date(now - 1000),
      startTime: new Date(now + 60_000),
      endTime: new Date(now + 120_000),
    }),
    createContest("running", "REGISTRATION", {
      registrationOpenTime: new Date(now - 120_000),
      startTime: new Date(now - 1000),
      endTime: new Date(now + 60_000),
    }),
    createContest("ended", "RUNNING", {
      registrationOpenTime: new Date(now - 180_000),
      startTime: new Date(now - 120_000),
      endTime: new Date(now - 1000),
    }),
    createContest("not-due", "SCHEDULED", {
      registrationOpenTime: new Date(now + 1000),
      startTime: new Date(now + 60_000),
      endTime: new Date(now + 120_000),
    }),
  ];
  const model = createModel(contests);
  const runner = createContestSchedulerRunner({
    ContestModel: model,
    now: () => now,
  });

  const result = await runner();
  assert.deepStrictEqual(result, { scanned: 4, transitioned: 3, failed: 0 });
  assert.deepStrictEqual(model.updates, [
    {
      filter: { _id: "registration", status: "SCHEDULED" },
      update: { $set: { status: "REGISTRATION" } },
    },
    {
      filter: { _id: "running", status: "REGISTRATION" },
      update: { $set: { status: "RUNNING" } },
    },
    {
      filter: { _id: "ended", status: "RUNNING" },
      update: { $set: { status: "ENDED" } },
    },
  ]);

  const raceModel = createModel(
    [createContest("race", "SCHEDULED", {
      registrationOpenTime: new Date(now - 1000),
      startTime: new Date(now + 60_000),
      endTime: new Date(now + 120_000),
    })],
    { race: false },
  );
  const raceRunner = createContestSchedulerRunner({
    ContestModel: raceModel,
    now: () => now,
  });
  assert.deepStrictEqual(await raceRunner(), { scanned: 1, transitioned: 0, failed: 0 });

  let concurrentUpdates = 0;
  const concurrentModel = createModel([createContest("concurrent", "SCHEDULED", {
    registrationOpenTime: new Date(now - 1000),
    startTime: new Date(now + 60_000),
    endTime: new Date(now + 120_000),
  })]);
  concurrentModel.updateOne = async (filter) => {
    concurrentUpdates += 1;
    return { modifiedCount: concurrentUpdates === 1 ? 1 : 0 };
  };
  const concurrentRunner = createContestSchedulerRunner({
    ContestModel: concurrentModel,
    now: () => now,
  });
  const concurrentResults = await Promise.all([concurrentRunner(), concurrentRunner()]);
  assert.deepStrictEqual(concurrentResults.map((result) => result.scanned), [1, 1]);
  assert.deepStrictEqual(
    concurrentResults.map((result) => result.transitioned).sort(),
    [0, 1],
  );
  assert.deepStrictEqual(concurrentResults.map((result) => result.failed), [0, 0]);

  const failures = [];
  const failureModel = createModel(contests.slice(0, 1));
  failureModel.updateOne = async () => {
    throw new Error("Mongo unavailable");
  };
  const failureRunner = createContestSchedulerRunner({
    ContestModel: failureModel,
    now: () => now,
    logger: { error: (...args) => failures.push(args) },
  });
  assert.deepStrictEqual(await failureRunner(), { scanned: 1, transitioned: 0, failed: 1 });
  assert.strictEqual(failures.length, 1);

  assert.strictEqual(CONTEST_SCHEDULER_INTERVAL_MS, 5000);
  console.log("✓ Contest scheduler tests passed");
}

runTests().catch((error) => {
  console.error("Contest scheduler tests failed:", error);
  process.exit(1);
});
