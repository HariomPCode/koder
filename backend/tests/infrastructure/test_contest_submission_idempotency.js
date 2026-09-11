const assert = require("assert");

class FakeRedis {
  constructor() {
    this.records = new Map();
    this.now = Date.now();
  }

  async get(key) {
    const record = this.records.get(key);
    if (!record || record.expiresAt <= this.now) {
      this.records.delete(key);
      return null;
    }
    return record.value;
  }

  async set(key, value, ...options) {
    const nx = options.includes("NX");
    const ttlIndex = options.indexOf("EX") + 1;
    const currentRecord = this.records.get(key);
    const current =
      currentRecord && currentRecord.expiresAt > this.now
        ? currentRecord.value
        : null;
    if (currentRecord && !current) {
      this.records.delete(key);
    }
    if (current && nx) {
      return null;
    }
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
    if (current !== expected) {
      return null;
    }
    this.records.set(key, {
      value,
      expiresAt: this.now + Number(ttl) * 1000,
    });
    return "OK";
  }
}

async function runTests() {
  const queuePath = require.resolve("../../queue");
  const originalQueueCache = require.cache[queuePath];
  const originalRepository = require("../../repositories/contest.repository");
  const originalRepositoryMethods = {
    findById: originalRepository.findById,
    findParticipant: originalRepository.findParticipant,
    createSubmission: originalRepository.createSubmission,
  };
  const shared = require("@koder/shared");
  const originalQuestionFindById = shared.Question.findById;
  const originalSubmissionUpdate = shared.Submission.findByIdAndUpdate;

  let submissionCount = 0;
  let queueCount = 0;
  const statuses = [];
  const contestId = "contest-1";
  const problemId = "problem-1";
  const questionId = "question-1";
  const contest = {
    _id: contestId,
    status: "RUNNING",
    startTime: new Date(Date.now() - 1000),
    problems: [
      { _id: problemId, questionId, order: 1, points: 100, penaltyMinutes: 5 },
      { _id: "problem-2", questionId, order: 2, points: 100, penaltyMinutes: 5 },
    ],
  };

  require.cache[queuePath] = {
    id: queuePath,
    filename: queuePath,
    loaded: true,
    exports: {
      connection: {},
      enqueueSubmission: async () => {
        queueCount += 1;
        return { id: `job-${queueCount}` };
      },
    },
  };

  const ContestService = require("../../services/contest.service");
  const SubmissionIdempotency = require("../../services/submissionIdempotency");

  originalRepository.findById = async (id) => ({ ...contest, _id: id });
  originalRepository.findParticipant = async () => ({ _id: "participant-1" });
  originalRepository.createSubmission = async (data) => {
    submissionCount += 1;
    return { ...data, _id: `submission-${submissionCount}` };
  };
  shared.Question.findById = async () => ({ _id: questionId });
  shared.Submission.findByIdAndUpdate = async (id, update) => {
    statuses.push({ id, status: update.status });
    return { _id: id };
  };

  function createGuard() {
    return SubmissionIdempotency.createSubmissionIdempotency({
      redis: new FakeRedis(),
      ttlSeconds: 60,
    });
  }

  try {
    const sameGuard = createGuard();
    const first = await ContestService.createContestSubmission({
      contestId,
      userId: "user-1",
      payload: { contestProblemId: problemId, language: "javascript", code: "return 1;" },
      idempotency: sameGuard,
    });
    const duplicate = await ContestService.createContestSubmission({
      contestId,
      userId: "user-1",
      payload: { contestProblemId: problemId, language: "javascript", code: "return 1;" },
      idempotency: sameGuard,
    });
    assert.strictEqual(first.submissionId, duplicate.submissionId);
    assert.strictEqual(submissionCount, 1);
    assert.strictEqual(queueCount, 1);

    const concurrentGuard = createGuard();
    const concurrent = await Promise.all([
      ContestService.createContestSubmission({
        contestId,
        userId: "user-2",
        payload: { contestProblemId: problemId, language: "javascript", code: "return 2;" },
        idempotency: concurrentGuard,
      }),
      ContestService.createContestSubmission({
        contestId,
        userId: "user-2",
        payload: { contestProblemId: problemId, language: "javascript", code: "return 2;" },
        idempotency: concurrentGuard,
      }),
    ]);
    assert.strictEqual(new Set(concurrent.map((item) => String(item.submissionId))).size, 1);
    assert.strictEqual(submissionCount, 2);
    assert.strictEqual(queueCount, 2);

    const distinctRequests = [
      { userId: "user-1", contestProblemId: problemId, code: "return 3;" },
      { userId: "user-1", contestProblemId: "problem-2", code: "return 1;" },
      { userId: "user-2", contestProblemId: problemId, code: "return 1;" },
      { userId: "user-1", contestProblemId: problemId, code: "return 1;", contestId: "contest-2" },
    ];
    for (const request of distinctRequests) {
      await ContestService.createContestSubmission({
        contestId: request.contestId || contestId,
        userId: request.userId,
        payload: {
          contestProblemId: request.contestProblemId,
          language: "javascript",
          code: request.code,
        },
        idempotency: createGuard(),
      });
    }
    assert.strictEqual(submissionCount, 6);
    assert.strictEqual(queueCount, 6);

    const failureGuard = createGuard();
    const originalEnqueue = require.cache[queuePath].exports.enqueueSubmission;
    require.cache[queuePath].exports.enqueueSubmission = async () => {
      throw new Error("Redis unavailable");
    };
    await assert.rejects(
      ContestService.createContestSubmission({
        contestId,
        userId: "user-failure",
        payload: { contestProblemId: problemId, language: "javascript", code: "return 4;" },
        idempotency: failureGuard,
      }),
      (error) => error.statusCode === 503,
    );
    require.cache[queuePath].exports.enqueueSubmission = originalEnqueue;
    const recovered = await ContestService.createContestSubmission({
      contestId,
      userId: "user-failure",
      payload: { contestProblemId: problemId, language: "javascript", code: "return 4;" },
      idempotency: failureGuard,
    });
    assert.strictEqual(recovered.status, "processing");
    assert.ok(statuses.some((entry) => entry.status === "created"));
  } finally {
    originalRepository.findById = originalRepositoryMethods.findById;
    originalRepository.findParticipant = originalRepositoryMethods.findParticipant;
    originalRepository.createSubmission = originalRepositoryMethods.createSubmission;
    shared.Question.findById = originalQuestionFindById;
    shared.Submission.findByIdAndUpdate = originalSubmissionUpdate;
    if (originalQueueCache) {
      require.cache[queuePath] = originalQueueCache;
    } else {
      delete require.cache[queuePath];
    }
  }

  console.log("✓ Contest submission idempotency tests passed");
}

runTests().catch((error) => {
  console.error("Contest submission idempotency tests failed:", error);
  process.exit(1);
});
