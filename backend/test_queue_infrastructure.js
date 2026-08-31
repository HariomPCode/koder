const assert = require("assert");
const IoRedis = require("ioredis");
const { Queue } = require("bullmq");
const {
  QUEUE_NAMES,
  JOB_NAMES,
  buildQueueJobId,
  createQueueJobOptions,
  QUEUE_RETRY_DEFAULTS,
  QUEUE_RETENTION_DEFAULTS,
} = require("../packages/shared/config/queues");
const { SUBMISSION_STATUS } = require("../packages/shared/contracts/verdicts");

async function runTests() {
  const passed = [];
  const failed = [];

  async function testCase(name, fn) {
    try {
      await fn();
      passed.push(name);
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed.push({ name, error });
      console.log(`  ✗ ${name}`);
      console.log(`    ${error.message}`);
    }
  }

  await testCase("Queue names remain language-specific and stable", () => {
    assert.deepStrictEqual(QUEUE_NAMES, {
      javascript: "js-queue",
      java: "java-queue",
      python: "python-queue",
    });
    assert.strictEqual(QUEUE_NAMES.javascript, "js-queue");
    assert.strictEqual(QUEUE_NAMES.java, "java-queue");
    assert.strictEqual(QUEUE_NAMES.python, "python-queue");
  });

  await testCase("Deterministic job IDs are language-scoped, stable, and BullMQ compatible", () => {
    const submissionId = "64e2d5ec5956e8d99d0f1234";
    const jsId = buildQueueJobId("javascript", submissionId);
    const javaId = buildQueueJobId("java", submissionId);
    const pythonId = buildQueueJobId("python", submissionId);

    assert.strictEqual(jsId, "javascript-64e2d5ec5956e8d99d0f1234");
    assert.strictEqual(javaId, "java-64e2d5ec5956e8d99d0f1234");
    assert.strictEqual(pythonId, "python-64e2d5ec5956e8d99d0f1234");

    assert.ok(!jsId.includes(":"));
    assert.ok(!javaId.includes(":"));
    assert.ok(!pythonId.includes(":"));
    assert.strictEqual(buildQueueJobId("javascript", submissionId), jsId);
    assert.notStrictEqual(jsId, javaId);
    assert.notStrictEqual(jsId, pythonId);
    assert.notStrictEqual(javaId, pythonId);
  });

  await testCase("BullMQ accepts the generated job IDs", async () => {
    const connection = new IoRedis({
      host: process.env.REDIS_HOST || "localhost",
      port: Number(process.env.REDIS_PORT) || 6379,
      maxRetriesPerRequest: null,
    });
    const queue = new Queue("js-queue", {
      connection,
      defaultJobOptions: createQueueJobOptions(),
    });

    try {
      const submissionId = "64e2d5ec5956e8d99d0f1234";
      const jobId = buildQueueJobId("javascript", submissionId);
      await queue.add("execute", { submissionId }, { jobId });
      const found = await queue.getJob(jobId);
      assert.ok(found, "BullMQ should accept and persist the generated job ID");
      assert.ok(!jobId.includes(":"));
      await found.remove();
    } finally {
      await queue.close();
      await connection.quit();
    }
  });

  await testCase("Queue job defaults include retry and bounded retention settings", () => {
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

  await testCase("Submission lifecycle contract includes created and queued states", () => {
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

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
