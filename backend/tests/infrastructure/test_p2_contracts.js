const assert = require("assert");

const { CONTEST_STATUS } = require("../../services/contestLifecycle");
const {
  buildStandings,
  createContestLeaderboardLifecycle,
} = require("../../services/contestLeaderboardLifecycle");
const eventBus = require("../../events/eventBus");
const { FAILURE_TYPES } = require("@koder/shared");

function queryResult(value) {
  return {
    lean: async () => value,
    select() {
      return this;
    },
    sort() {
      return this;
    },
  };
}

async function runTests() {
  const contest = {
    _id: "contest-1",
    status: CONTEST_STATUS.RUNNING,
    startTime: new Date("2026-09-11T12:00:00.000Z"),
  };
  const participants = [
    { userId: "user-2", solvedCount: 1, totalPenalty: 20 },
    { userId: "user-1", solvedCount: 2, totalPenalty: 10 },
  ];
  const snapshots = [];
  const lifecycle = createContestLeaderboardLifecycle({
    distributedSnapshotLock: false,
    ContestModel: { findById: () => queryResult(contest) },
    ParticipantModel: {
      find: () => queryResult(participants),
    },
    SnapshotModel: {
      create: async (snapshot) => {
        snapshots.push(snapshot);
        return snapshot;
      },
    },
    logger: { warn() {} },
    intervalMs: 10,
  });

  assert.deepStrictEqual(buildStandings(contest, participants).map((entry) => entry.rank), [1, 2]);
  assert.strictEqual((await lifecycle.snapshotRunningContest("contest-1")).status, "created");
  assert.strictEqual(snapshots[0].isFinal, false);
  assert.deepStrictEqual(snapshots[0].standings.map((entry) => entry.userId), ["user-1", "user-2"]);

  let resolveSnapshot;
  const blockingLifecycle = createContestLeaderboardLifecycle({
    distributedSnapshotLock: false,
    ContestModel: { findById: () => queryResult(contest) },
    ParticipantModel: {
      find: () => ({
        sort() {
          return {
            lean: () => new Promise((resolve) => {
              resolveSnapshot = resolve;
            }),
          };
        },
      }),
    },
    SnapshotModel: { create: async (snapshot) => snapshot },
  });
  const first = blockingLifecycle.snapshotRunningContest("contest-1");
  assert.strictEqual(
    (await blockingLifecycle.snapshotRunningContest("contest-1")).status,
    "already_running",
  );
  resolveSnapshot(participants);
  await first;

  const scheduled = lifecycle.start();
  assert.strictEqual(lifecycle.start(), scheduled);
  scheduled.stop();

  let contestStatus = "RUNNING";
  let discarded = false;
  const raceLifecycle = createContestLeaderboardLifecycle({
    distributedSnapshotLock: false,
    ContestModel: {
      findById: () => ({
        select() {
          return {
            lean: async () => ({ status: contestStatus }),
          };
        },
        lean: async () => ({ ...contest, status: contestStatus }),
      }),
    },
    ParticipantModel: { find: () => queryResult(participants) },
    SnapshotModel: {
      create: async (snapshot) => {
        contestStatus = "FINALIZED";
        return { ...snapshot, _id: "race-snapshot" };
      },
      deleteOne: async () => {
        discarded = true;
      },
    },
  });
  assert.strictEqual(
    (await raceLifecycle.snapshotRunningContest("contest-1")).status,
    "discarded",
  );
  assert.strictEqual(discarded, true);

  let localEvent;
  const originalEnsureRedis = eventBus.ensureRedis;
  const originalPublisher = eventBus.publisher;
  eventBus.publisher = {
    publish: async () => 0,
    xadd: async () => "1-0",
  };
  eventBus.ensureRedis = () => {};
  const unsubscribe = eventBus.on("test.p2", (payload, name, envelope) => {
    localEvent = { payload, name, envelope };
  });
  eventBus.emit("test.p2", { userId: "user-1" });
  unsubscribe();
  eventBus.ensureRedis = originalEnsureRedis;
  eventBus.publisher = originalPublisher;

  assert.deepStrictEqual(localEvent.payload, { userId: "user-1" });
  assert.strictEqual(localEvent.name, "test.p2");
  assert.strictEqual(localEvent.envelope.schemaVersion, 1);
  assert.ok(localEvent.envelope.eventId);
  assert.deepStrictEqual(FAILURE_TYPES, {
    USER_CODE: "user_code",
    INFRASTRUCTURE: "infrastructure",
  });

  console.log("P2 contract and lifecycle tests passed");
}

runTests().catch((error) => {
  console.error("P2 contract and lifecycle tests failed:", error);
  process.exit(1);
});
