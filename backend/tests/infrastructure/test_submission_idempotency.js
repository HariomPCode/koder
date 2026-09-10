const assert = require("assert");
const { SUBMISSION_STATUS } = require("@koder/shared");
const {
  buildSubmissionIdempotencyKey,
  createSubmissionIdempotency,
} = require("../../services/submissionIdempotency");

class FakeRedis {
  constructor() {
    this.records = new Map();
    this.now = Date.now();
  }

  async get(key) {
    const record = this.records.get(key);
    if (!record) return null;
    if (record.expiresAt <= this.now) {
      this.records.delete(key);
      return null;
    }
    return record.value;
  }

  async set(key, value, ...options) {
    const nx = options.includes("NX");
    const ttlIndex = options.indexOf("EX") + 1;
    const existing = this.records.get(key);
    if (existing && existing.expiresAt > this.now && nx) return null;
    if (existing && existing.expiresAt <= this.now) this.records.delete(key);
    this.records.set(key, {
      value,
      expiresAt: this.now + Number(options[ttlIndex]) * 1000,
    });
    return "OK";
  }

  async eval(script, keyCount, key, expected, value, ttl) {
    const current = await this.get(key);
    if (script.includes("DEL")) {
      if (current === expected) {
        this.records.delete(key);
        return 1;
      }
      return 0;
    }
    if (current !== expected) return null;
    this.records.set(key, {
      value,
      expiresAt: this.now + Number(ttl) * 1000,
    });
    return "OK";
  }
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function testCase(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed += 1;
    } catch (error) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${error.message}`);
      failed += 1;
    }
  }

  await testCase("different identity fields produce different hashed keys", async () => {
    const base = { userId: "user-1", questionId: "question-1", code: "return 1;" };
    const keys = [
      buildSubmissionIdempotencyKey(base),
      buildSubmissionIdempotencyKey({ ...base, userId: "user-2" }),
      buildSubmissionIdempotencyKey({ ...base, questionId: "question-2" }),
      buildSubmissionIdempotencyKey({ ...base, code: "return 2;" }),
    ];
    assert.strictEqual(new Set(keys).size, 4);
    assert.ok(keys[0].startsWith("idempotency:submission:"));
    assert.ok(!keys[0].includes(base.code));
  });

  await testCase("only one concurrent request acquires the reservation", async () => {
    const redis = new FakeRedis();
    const idempotency = createSubmissionIdempotency({ redis, ttlSeconds: 60 });
    const results = await Promise.all([
      idempotency.reserve({ userId: "u", questionId: "q", code: "x" }),
      idempotency.reserve({ userId: "u", questionId: "q", code: "x" }),
    ]);
    assert.strictEqual(results.filter((result) => result.type === "owner").length, 1);
    assert.strictEqual(results.filter((result) => result.type === "in_progress").length, 1);
  });

  await testCase("published submission ID is returned to duplicate requests", async () => {
    const redis = new FakeRedis();
    const idempotency = createSubmissionIdempotency({ redis, ttlSeconds: 60 });
    const first = await idempotency.reserve({ userId: "u", questionId: "q", code: "x" });
    await idempotency.publish({ ...first, submissionId: "submission-1" });
    const duplicate = await idempotency.reserve({ userId: "u", questionId: "q", code: "x" });
    assert.deepStrictEqual(duplicate, { type: "existing", submissionId: "submission-1" });
  });

  await testCase("reservation is released after MongoDB creation failure", async () => {
    const redis = new FakeRedis();
    const idempotency = createSubmissionIdempotency({ redis, ttlSeconds: 60 });
    const first = await idempotency.reserve({ userId: "u", questionId: "q", code: "x" });
    await idempotency.release(first);
    const retry = await idempotency.reserve({ userId: "u", questionId: "q", code: "x" });
    assert.strictEqual(retry.type, "owner");
  });

  await testCase("expired reservation can be acquired again", async () => {
    const redis = new FakeRedis();
    const idempotency = createSubmissionIdempotency({ redis, ttlSeconds: 60 });
    const first = await idempotency.reserve({ userId: "u", questionId: "q", code: "x" });
    redis.now += 60001;
    const retry = await idempotency.reserve({ userId: "u", questionId: "q", code: "x" });
    assert.strictEqual(first.type, "owner");
    assert.strictEqual(retry.type, "owner");
  });

  await testCase("published records remain independent of submission status recovery", async () => {
    const redis = new FakeRedis();
    const idempotency = createSubmissionIdempotency({ redis, ttlSeconds: 60 });
    const first = await idempotency.reserve({ userId: "u", questionId: "q", code: "x" });
    await idempotency.publish({ ...first, submissionId: "submission-created" });
    const duplicate = await idempotency.reserve({ userId: "u", questionId: "q", code: "x" });
    assert.strictEqual(duplicate.submissionId, "submission-created");
    assert.strictEqual(SUBMISSION_STATUS.CREATED, "created");
  });

  await testCase("service returns the published submission without creating a duplicate", async () => {
    const queuePath = require.resolve("../../queue");
    require.cache[queuePath] = {
      id: queuePath,
      filename: queuePath,
      loaded: true,
      exports: {
        connection: {},
        enqueueSubmission: async () => {
          throw new Error("must not enqueue duplicate");
        },
      },
    };

    const SubmissionService = require("../../services/submission.service");
    const SubmissionRepository = require("../../repositories/submission.repository");
    const QuestionRepository = require("../../repositories/question.repository");
    const originalCreate = SubmissionRepository.create;
    const originalFindQuestion = QuestionRepository.findById;
    let createCalls = 0;
    SubmissionRepository.create = async () => {
      createCalls += 1;
      return { _id: "507f1f77bcf86cd799439011" };
    };
    QuestionRepository.findById = async () => ({ _id: "507f1f77bcf86cd799439012" });

    try {
      const result = await SubmissionService.createSubmission({
        userId: "507f1f77bcf86cd799439013",
        questionId: "507f1f77bcf86cd799439012",
        language: "javascript",
        code: "return 1;",
        idempotency: {
          reserve: async () => ({ type: "existing", submissionId: "507f1f77bcf86cd799439011" }),
        },
      });
      assert.strictEqual(result.submissionId, "507f1f77bcf86cd799439011");
      assert.strictEqual(createCalls, 0);
    } finally {
      SubmissionRepository.create = originalCreate;
      QuestionRepository.findById = originalFindQuestion;
    }
  });

  await testCase("queue failure leaves the published submission recoverable", async () => {
    const SubmissionService = require("../../services/submission.service");
    const SubmissionRepository = require("../../repositories/submission.repository");
    const QuestionRepository = require("../../repositories/question.repository");
    const originalCreate = SubmissionRepository.create;
    const originalUpdateStatus = SubmissionRepository.updateStatus;
    const originalFindQuestion = QuestionRepository.findById;
    const statuses = [];
    const guardCalls = [];
    SubmissionRepository.create = async () => ({ _id: "507f1f77bcf86cd799439014" });
    SubmissionRepository.updateStatus = async (id, status) => {
      statuses.push({ id, status });
    };
    QuestionRepository.findById = async () => ({ _id: "507f1f77bcf86cd799439012" });

    try {
      await assert.rejects(
        SubmissionService.createSubmission({
          userId: "507f1f77bcf86cd799439013",
          questionId: "507f1f77bcf86cd799439012",
          language: "javascript",
          code: "return 2;",
          idempotency: {
            reserve: async () => ({ type: "owner", key: "key", token: "token" }),
            publish: async () => guardCalls.push("publish"),
            release: async () => guardCalls.push("release"),
          },
        }),
        (error) => error.statusCode === 503,
      );
      assert.deepStrictEqual(guardCalls, ["publish"]);
      assert.deepStrictEqual(statuses, [{ id: "507f1f77bcf86cd799439014", status: SUBMISSION_STATUS.CREATED }]);
    } finally {
      SubmissionRepository.create = originalCreate;
      SubmissionRepository.updateStatus = originalUpdateStatus;
      QuestionRepository.findById = originalFindQuestion;
    }
  });

  await testCase("Redis failure is surfaced before a submission is created", async () => {
    const SubmissionService = require("../../services/submission.service");
    const SubmissionRepository = require("../../repositories/submission.repository");
    const QuestionRepository = require("../../repositories/question.repository");
    const originalCreate = SubmissionRepository.create;
    const originalFindQuestion = QuestionRepository.findById;
    let createCalls = 0;
    SubmissionRepository.create = async () => {
      createCalls += 1;
      return { _id: "507f1f77bcf86cd799439015" };
    };
    QuestionRepository.findById = async () => ({ _id: "507f1f77bcf86cd799439012" });

    try {
      await assert.rejects(
        SubmissionService.createSubmission({
          userId: "507f1f77bcf86cd799439013",
          questionId: "507f1f77bcf86cd799439012",
          language: "javascript",
          code: "return 3;",
          idempotency: {
            reserve: async () => {
              throw new Error("redis unavailable");
            },
          },
        }),
        (error) => error.statusCode === 503,
      );
      assert.strictEqual(createCalls, 0);
    } finally {
      SubmissionRepository.create = originalCreate;
      QuestionRepository.findById = originalFindQuestion;
    }
  });

  console.log(`\nSubmission idempotency tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
