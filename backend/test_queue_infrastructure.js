const assert = require("assert");
const {
  QUEUE_NAMES,
  JOB_NAMES,
  buildQueueJobId,
  createQueueJobOptions,
  QUEUE_RETRY_DEFAULTS,
  QUEUE_RETENTION_DEFAULTS,
} = require("../packages/shared/config/queues");
const { SUBMISSION_STATUS } = require("../packages/shared/contracts/verdicts");

function runTests() {
  const passed = [];
  const failed = [];

  function testCase(name, fn) {
    try {
      fn();
      passed.push(name);
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed.push({ name, error });
      console.log(`  ✗ ${name}`);
      console.log(`    ${error.message}`);
    }
  }

  testCase("Queue names remain language-specific and stable", () => {
    assert.deepStrictEqual(QUEUE_NAMES, {
      javascript: "js-queue",
      java: "java-queue",
      python: "python-queue",
    });
    assert.strictEqual(QUEUE_NAMES.javascript, "js-queue");
    assert.strictEqual(QUEUE_NAMES.java, "java-queue");
    assert.strictEqual(QUEUE_NAMES.python, "python-queue");
  });

  testCase("Deterministic job IDs are language-scoped and stable", () => {
    assert.strictEqual(buildQueueJobId("javascript", "64e2d5ec5956e8d99d0f1234"), "javascript:64e2d5ec5956e8d99d0f1234");
    assert.strictEqual(buildQueueJobId("java", "64e2d5ec5956e8d99d0f1234"), "java:64e2d5ec5956e8d99d0f1234");
    assert.strictEqual(buildQueueJobId("python", "64e2d5ec5956e8d99d0f1234"), "python:64e2d5ec5956e8d99d0f1234");
  });

  testCase("Queue job defaults include retry and bounded retention settings", () => {
    const options = createQueueJobOptions();
    assert.strictEqual(options.attempts, QUEUE_RETRY_DEFAULTS.attempts);
    assert.strictEqual(options.backoff.type, QUEUE_RETRY_DEFAULTS.backoff.type);
    assert.strictEqual(options.backoff.delay, QUEUE_RETRY_DEFAULTS.backoff.delay);
    assert.deepStrictEqual(options.removeOnComplete, {
      age: QUEUE_RETENTION_DEFAULTS.completed.age,
      count: QUEUE_RETENTION_DEFAULTS.completed.count,
    });
    assert.deepStrictEqual(options.removeOnFail, {
      age: QUEUE_RETENTION_DEFAULTS.failed.age,
      count: QUEUE_RETENTION_DEFAULTS.failed.count,
    });
    assert.strictEqual(JOB_NAMES.EXECUTE, "execute");
  });

  testCase("Submission lifecycle contract includes created and queued states", () => {
    assert.strictEqual(SUBMISSION_STATUS.CREATED, "created");
    assert.strictEqual(SUBMISSION_STATUS.QUEUED, "queued");
    assert.strictEqual(SUBMISSION_STATUS.RUNNING, "running");
    assert.strictEqual(SUBMISSION_STATUS.COMPLETED, "completed");
    assert.ok(Object.values(SUBMISSION_STATUS).includes("pending"));
  });

  console.log("\n=======================================================================");
  console.log("TESTING QUEUE INFRASTRUCTURE (PHASE 3)");
  console.log("=======================================================================\n");

  if (failed.length > 0) {
    console.log(`\n${passed.length} passed, ${failed.length} failed`);
    throw new Error(`Queue infrastructure checks failed: ${failed.length}`);
  }

  console.log(`\n${passed.length} passed, 0 failed`);
}

runTests();
