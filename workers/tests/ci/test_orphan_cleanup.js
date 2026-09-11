const assert = require("assert");
const {
  shouldRemoveContainer,
} = require("../../common/orphanContainerCleanup");
const {
  startPeriodicOrphanCleanup,
} = { startPeriodicOrphanCleanup: require("../../common/periodicOrphanCleanup") };

function inspection({ labels, createdAt }) {
  return { labels, createdAt };
}

async function testOwnershipAndAge() {
  const now = Date.parse("2026-09-11T12:00:00.000Z");
  const old = now - 10 * 60 * 1000;
  const maxAgeMs = 5 * 60 * 1000;
  const managed = inspection({
    labels: {
      "koder.managed": "true",
      "koder.worker": "koder",
      "koder.jobId": "job-1",
    },
    createdAt: old,
  });

  assert.strictEqual(shouldRemoveContainer({
    inspection: managed,
    containerId: "container-1",
    maxAgeMs,
    now,
  }), true);
  assert.strictEqual(shouldRemoveContainer({
    inspection: managed,
    containerId: "container-1",
    maxAgeMs,
    now,
    activeJobIds: new Set(["job-1"]),
  }), false);
  assert.strictEqual(shouldRemoveContainer({
    inspection: inspection({
      labels: { "koder.managed": "false", "koder.worker": "koder", "koder.jobId": "job-2" },
      createdAt: old,
    }),
    containerId: "container-2",
    maxAgeMs,
    now,
  }), false);
  assert.strictEqual(shouldRemoveContainer({
    inspection: inspection({
      labels: { "koder.managed": "true", "koder.worker": "other", "koder.jobId": "job-3" },
      createdAt: old,
    }),
    containerId: "container-3",
    maxAgeMs,
    now,
  }), false);
  assert.strictEqual(shouldRemoveContainer({
    inspection: { labels: managed.labels, createdAt: now - 1000 },
    containerId: "container-4",
    maxAgeMs,
    now,
  }), false);
}

async function testNonOverlappingPeriodicRunner() {
  let timerCallback;
  let clearedTimer = null;
  let releaseSweep;
  let sweepCalls = 0;
  const sweep = async () => {
    sweepCalls += 1;
    await new Promise((resolve) => {
      releaseSweep = resolve;
    });
  };
  const scheduler = startPeriodicOrphanCleanup({
    intervalMs: 1000,
    maxAgeMs: 1000,
    activeJobIds: new Set(),
    sweep,
    setIntervalFn: (callback) => {
      timerCallback = callback;
      return "timer-1";
    },
    clearIntervalFn: (timer) => {
      clearedTimer = timer;
    },
  });

  const first = scheduler.run();
  const second = await scheduler.run();
  assert.deepStrictEqual(second, { skipped: "already_running" });
  assert.strictEqual(sweepCalls, 1);
  releaseSweep();
  await first;
  await timerCallback();
  assert.strictEqual(sweepCalls, 2);
  await scheduler.stop();
  assert.strictEqual(clearedTimer, "timer-1");
}

async function runTests() {
  await testOwnershipAndAge();
  await testNonOverlappingPeriodicRunner();
  console.log("Orphan cleanup tests passed");
}

runTests().catch((error) => {
  console.error("Orphan cleanup tests failed:", error);
  process.exit(1);
});
