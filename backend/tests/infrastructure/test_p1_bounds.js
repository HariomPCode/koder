const assert = require("assert");
const { PassThrough } = require("stream");
const bullmqPath = require.resolve("bullmq");
const ioredisPath = require.resolve("ioredis");
const originalBullmq = require.cache[bullmqPath];
const originalIoredis = require.cache[ioredisPath];
class FakeRedis {
  constructor() {
    this.status = "ready";
  }
  on() {
    return this;
  }
  disconnect() {}
}
class FakeQueue {
  constructor(name) {
    this.name = name;
  }
  on() {
    return this;
  }
  async add(name, payload, options) {
    return { id: options.jobId, name, payload, options };
  }
  async close() {}
}
require.cache[bullmqPath] = {
  id: bullmqPath,
  filename: bullmqPath,
  loaded: true,
  exports: { Queue: FakeQueue },
};
require.cache[ioredisPath] = {
  id: ioredisPath,
  filename: ioredisPath,
  loaded: true,
  exports: FakeRedis,
};
const queueAdapter = require("../../queue/queueAdapter");
const SubmissionRepository = require("../../repositories/submission.repository");
const QuestionRepository = require("../../repositories/question.repository");
const ContestRepository = require("../../repositories/contest.repository");
const ContestService = require("../../services/contest.service");
const UserService = require("../../services/user.service");
const { QUEUE_PRIORITY } = require("../../../packages/shared/config/queues");
const { parsePagination } = require("../../utils/pagination");
const { createLogger } = require("../../../packages/shared/logger");

async function testQueuePriority() {
  const originalQueue = queueAdapter.queueMap.javascript;
  const originalUpdate = SubmissionRepository.updateStatusIfCurrent;
  const jobs = [];
  queueAdapter.queueMap.javascript = {
    add: async (name, payload, options) => {
      jobs.push({ name, payload, options });
      return { id: options.jobId };
    },
  };
  SubmissionRepository.updateStatusIfCurrent = async () => null;

  try {
    await queueAdapter.enqueueSubmission({
      submissionId: "practice-1",
      language: "javascript",
      userId: "user-1",
      questionId: "question-1",
    });
    await queueAdapter.enqueueSubmission({
      submissionId: "contest-1",
      language: "javascript",
      userId: "user-1",
      questionId: "question-1",
      contestId: "contest-1",
    });
  } finally {
    queueAdapter.queueMap.javascript = originalQueue;
    SubmissionRepository.updateStatusIfCurrent = originalUpdate;
  }

  assert.strictEqual(jobs[0].options.priority, QUEUE_PRIORITY.practice);
  assert.strictEqual(jobs[1].options.priority, QUEUE_PRIORITY.contest);
  assert.ok(jobs[1].options.priority < jobs[0].options.priority);
  assert.strictEqual(jobs[0].options.jobId, "javascript-practice-1");
  assert.strictEqual(jobs[1].options.jobId, "javascript-contest-1");
}

async function testStatsUseBoundedReadsAndExactAggregates() {
  const original = {
    summary: SubmissionRepository.getUserStatsSummary,
    days: SubmissionRepository.getUserActivityDays,
    recent: SubmissionRepository.findRecentForStats,
    solved: SubmissionRepository.findRecentlySolvedForStats,
    weekly: SubmissionRepository.getWeeklyStats,
    old: SubmissionRepository.findByUserId,
    questions: QuestionRepository.findAllForStats,
  };
  const question1 = { _id: "q1", title: "One", slug: "one", difficulty: "Easy" };
  const question2 = { _id: "q2", title: "Two", slug: "two", difficulty: "Hard" };
  try {
    SubmissionRepository.findByUserId = async () => {
      throw new Error("unbounded findByUserId must not be used");
    };
    SubmissionRepository.getUserStatsSummary = async () => ({
      totalSubmissions: 100000,
      acceptedSubmissions: 40000,
      attemptedQuestionIds: ["q1", "q2"],
      solvedQuestionIds: ["q1"],
    });
    SubmissionRepository.getUserActivityDays = async () => [{ _id: "2026-09-11" }];
    SubmissionRepository.findRecentForStats = async (_userId, limit) => {
      assert.strictEqual(limit, 5);
      return [{
        questionId: "q1",
        language: "javascript",
        verdict: "Accepted",
        createdAt: new Date("2026-09-11T10:00:00.000Z"),
      }];
    };
    SubmissionRepository.findRecentlySolvedForStats = async (_userId, limit) => {
      assert.strictEqual(limit, 5);
      return [{ _id: "q1", solvedAt: new Date("2026-09-11T10:00:00.000Z") }];
    };
    SubmissionRepository.getWeeklyStats = async () => ({
      attemptedQuestionIds: ["q1"],
      solvedQuestionIds: ["q1"],
    });
    QuestionRepository.findAllForStats = async () => [question1, question2];

    const stats = await UserService.getUserStats("user-1");
    assert.strictEqual(stats.totalSubmissions, 100000);
    assert.strictEqual(stats.acceptedSubmissions, 40000);
    assert.strictEqual(stats.solvedCount, 1);
    assert.strictEqual(stats.attemptedCount, 2);
    assert.strictEqual(stats.solvedEasyQuestions, 1);
    assert.strictEqual(stats.solvedHardQuestions, 0);
    assert.strictEqual(stats.recentSubmissions.length, 1);
    assert.strictEqual(stats.recentlySolved.length, 1);
  } finally {
    Object.assign(SubmissionRepository, {
      getUserStatsSummary: original.summary,
      getUserActivityDays: original.days,
      findRecentForStats: original.recent,
      findRecentlySolvedForStats: original.solved,
      getWeeklyStats: original.weekly,
      findByUserId: original.old,
    });
    QuestionRepository.findAllForStats = original.questions;
  }
}

async function testPaginationAndFilters() {
  assert.deepStrictEqual(parsePagination({ page: "3", limit: "999" }), {
    page: 3,
    limit: 100,
    skip: 200,
  });

  const originalFindAll = ContestRepository.findAll;
  const originalCountAll = ContestRepository.countAll;
  const originalFindById = ContestRepository.findById;
  const originalListSubmissions = ContestRepository.listSubmissions;
  const originalCountSubmissions = ContestRepository.countSubmissions;
  const calls = [];
  try {
    ContestRepository.findAll = async (options) => {
      calls.push(["contests", options]);
      return [{ _id: "contest-1" }];
    };
    ContestRepository.countAll = async () => 101;
    const contests = await ContestService.listContests({ page: "2", limit: "999" });
    assert.strictEqual(contests.pagination.limit, 100);
    assert.strictEqual(contests.pagination.totalPages, 2);
    assert.deepStrictEqual(calls[0], ["contests", { page: 2, limit: 100, skip: 100 }]);

    ContestRepository.findById = async () => ({ _id: "contest-1" });
    ContestRepository.listSubmissions = async (contestId, userId, options) => {
      calls.push(["submissions", contestId, userId, options]);
      return [];
    };
    ContestRepository.countSubmissions = async (contestId, userId) => {
      assert.strictEqual(contestId, "contest-1");
      assert.strictEqual(userId, "user-1");
      return 0;
    };
    const submissions = await ContestService.getContestSubmissions({
      contestId: "contest-1",
      userId: "user-1",
      requesterUserId: "user-1",
      page: "2",
      limit: "5",
    });
    assert.deepStrictEqual(submissions.pagination, {
      page: 2,
      limit: 5,
      total: 0,
      totalPages: 0,
    });
    assert.deepStrictEqual(calls[1], [
      "submissions",
      "contest-1",
      "user-1",
      { page: 2, limit: 5, skip: 5 },
    ]);
  } finally {
    ContestRepository.findAll = originalFindAll;
    ContestRepository.countAll = originalCountAll;
    ContestRepository.findById = originalFindById;
    ContestRepository.listSubmissions = originalListSubmissions;
    ContestRepository.countSubmissions = originalCountSubmissions;
  }
}

async function testStructuredLogger() {
  const stream = new PassThrough();
  let output = "";
  stream.on("data", (chunk) => {
    output += chunk.toString();
  });
  const logger = createLogger("test", { stream, level: "info" });
  logger.info({
    event: "submission_created",
    submissionId: "submission-1",
  });
  await new Promise((resolve) => setImmediate(resolve));
  const entry = JSON.parse(output.trim());
  assert.strictEqual(entry.component, "test");
  assert.strictEqual(entry.event, "submission_created");
  assert.strictEqual(entry.submissionId, "submission-1");
  assert.strictEqual(entry.code, undefined);
}

async function runTests() {
  await testQueuePriority();
  await testStatsUseBoundedReadsAndExactAggregates();
  await testPaginationAndFilters();
  await testStructuredLogger();
  queueAdapter.connection.disconnect();
  if (originalBullmq) require.cache[bullmqPath] = originalBullmq;
  else delete require.cache[bullmqPath];
  if (originalIoredis) require.cache[ioredisPath] = originalIoredis;
  else delete require.cache[ioredisPath];
  console.log("P1 queue, stats, pagination, and logging tests passed");
}

runTests().catch((error) => {
  console.error("P1 bounds tests failed:", error);
  process.exit(1);
});
