const assert = require("assert");
const mongoose = require("mongoose");
const IoRedis = require("ioredis");

process.env.MONGODB_URI =
  process.env.ISSUE706_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/koder_phase7_issue706_test";

const createApp = require("../../backend/app");
const User = require("../../backend/models/User");
const Question = require("../../backend/models/Question");
const Contest = require("../../backend/models/Contest");
const ContestParticipant = require("../../backend/models/ContestParticipant");
const ContestParticipantProblem = require("../../backend/models/ContestParticipantProblem");
const ContestScoredSubmission = require("../../backend/models/ContestScoredSubmission");
const ContestLeaderboardSnapshot = require("../../backend/models/ContestLeaderboardSnapshot");
const ContestFinalizationAudit = require("../../backend/models/ContestFinalizationAudit");
const Submission = require("../../backend/models/Submission");
const ContestService = require("../../backend/services/contest.service");
const { closeRedis: closeStandingsRedis } = require("../../backend/services/standings.service");
const queue = require("../../backend/queue");
const {
  JUDGE_VERDICTS,
  SUBMISSION_STATUS,
  applySubmissionResult,
  buildLeaderboardActiveVersionKey,
  buildLeaderboardGenerationPattern,
  buildLeaderboardKey,
  buildLeaderboardMembersKey,
  buildLeaderboardMetaKey,
  getRedisConfig,
  setLeaderboardProjectionEnqueuer,
  triggerContestScoring,
  LEADERBOARD_HEALTH,
  LEADERBOARD_META_STATE,
} = require("@koder/shared");
const {
  createLeaderboardProjectionService,
} = require("../../backend/services/leaderboard-projection.service");

const {
  createProjectionProcessor: createWorkerProcessor,
} = require("../../workers/leaderboard/projectionProcessor");

const redis = new IoRedis({ ...getRedisConfig(), db: 15 });
let server;

function redisKeyOptions(contestId) {
  return {
    active: buildLeaderboardActiveVersionKey(contestId),
    pattern: buildLeaderboardGenerationPattern(contestId),
  };
}

async function deleteContestKeys(contestId) {
  const { active, pattern } = redisKeyOptions(contestId);
  let cursor = "0";
  const keys = [active];
  do {
    const [next, found] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = next;
    keys.push(...found);
  } while (cursor !== "0");
  if (keys.length) await redis.del(...keys);
}

async function resetDb() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
  await mongoose.connection.dropDatabase();
  await Promise.all([
    User.syncIndexes(),
    Question.syncIndexes(),
    Contest.syncIndexes(),
    ContestParticipant.syncIndexes(),
    ContestParticipantProblem.syncIndexes(),
    ContestScoredSubmission.syncIndexes(),
    ContestLeaderboardSnapshot.syncIndexes(),
    ContestFinalizationAudit.syncIndexes(),
    Submission.syncIndexes(),
  ]);
}

async function createFixture() {
  const admin = await User.create({
    firstName: "Issue",
    lastName: "706 Admin",
    email: `issue706-admin-${Date.now()}@example.com`,
    password: "hashed-password",
    role: "admin",
  });
  const users = await User.create(
    ["Alpha", "Beta", "Gamma"].map((name, index) => ({
      firstName: "Issue706",
      lastName: name,
      email: `issue706-user-${Date.now()}-${index}@example.com`,
      password: "hashed-password",
    })),
  );
  const questions = await Question.create(
    ["one", "two"].map((suffix, index) => ({
      questionNum: 7060 + index,
      title: `Issue 706 ${suffix}`,
      slug: `issue-706-${suffix}-${Date.now()}-${index}`,
      difficulty: "Easy",
      description: "Issue 706 integration fixture",
      starterCode: [{ language: "javascript", code: "function solve() {}" }],
      functionName: "solve",
      parameters: [{ name: "input", type: "string" }],
      returnType: "string",
      constraints: ["1 <= n <= 100"],
      tags: ["phase7"],
    })),
  );
  const now = Date.now();
  const contest = await Contest.create({
    title: "Issue 706 Integration Contest",
    slug: `issue-706-${now}`,
    description: "Integrated Phase 7 validation",
    registrationOpenTime: new Date(now - 3600000),
    startTime: new Date(now - 1800000),
    endTime: new Date(now + 1800000),
    status: "RUNNING",
    createdBy: admin._id,
    problems: questions.map((question, index) => ({
      questionId: question._id,
      order: index + 1,
      points: 100,
      penaltyMinutes: 5,
    })),
  });
  await ContestParticipant.insertMany(
    users.map((user) => ({ contestId: contest._id, userId: user._id })),
  );
  return { admin, users, questions, contest };
}

async function createSubmission({ fixture, userIndex, problemIndex, ms, verdict }) {
  const { contest, users, questions } = fixture;
  return Submission.create({
    userId: users[userIndex]._id,
    questionId: questions[problemIndex]._id,
    contestId: contest._id,
    contestProblemId: contest.problems[problemIndex]._id,
    submittedAtContestMs: ms,
    code: "function solve() {}",
    language: "javascript",
    status: SUBMISSION_STATUS.COMPLETED,
    verdict,
    passedTestCases: verdict === JUDGE_VERDICTS.ACCEPTED ? 1 : 0,
    totalTestCases: 1,
  });
}

async function processQueuedJobs(jobs, redisConnection = redis) {
  const processor = createWorkerProcessor({
    ContestModel: Contest,
    ContestParticipantModel: ContestParticipant,
    redis: redisConnection,
    now: () => Date.now(),
  });
  for (const payload of jobs.splice(0)) {
    await processor({ data: payload });
  }
}

async function rebuild(contestId, redisConnection = redis) {
  return createLeaderboardProjectionService({
    ContestModel: Contest,
    ParticipantModel: ContestParticipant,
    redis: redisConnection,
    now: () => Date.now(),
    batchSize: 2,
  }).rebuildContest(contestId, { reason: "ISSUE-706 validation" });
}

async function readApi(contestId, query = "") {
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/v1/contests/${contestId}/standings${query}`,
  );
  assert.strictEqual(response.status, 200);
  return response.json();
}

async function run() {
  await redis.connect().catch((error) => {
    if (!/already connecting|already open/i.test(error.message)) throw error;
  });
  await resetDb();
  server = createApp().listen(0);
  server.unref();

  const fixture = await createFixture();
  const contestId = String(fixture.contest._id);
  const jobs = [];
  setLeaderboardProjectionEnqueuer(async (payload) => jobs.push(payload));

  try {
    await deleteContestKeys(contestId);

    // Build an initially empty live projection, then exercise the real scoring
    // result -> enqueue -> worker -> Redis -> HTTP standings path.
    await rebuild(contestId);
    const submissions = [
      await createSubmission({ fixture, userIndex: 0, problemIndex: 0, ms: 60000, verdict: JUDGE_VERDICTS.WRONG_ANSWER }),
      await createSubmission({ fixture, userIndex: 0, problemIndex: 0, ms: 120000, verdict: JUDGE_VERDICTS.ACCEPTED }),
      await createSubmission({ fixture, userIndex: 0, problemIndex: 1, ms: 240000, verdict: JUDGE_VERDICTS.ACCEPTED }),
      await createSubmission({ fixture, userIndex: 1, problemIndex: 0, ms: 90000, verdict: JUDGE_VERDICTS.ACCEPTED }),
      await createSubmission({ fixture, userIndex: 2, problemIndex: 0, ms: 300000, verdict: JUDGE_VERDICTS.ACCEPTED }),
      await createSubmission({ fixture, userIndex: 1, problemIndex: 0, ms: 80000, verdict: JUDGE_VERDICTS.ACCEPTED }),
    ];
    for (const submission of [submissions[1], submissions[0], submissions[2], submissions[4], submissions[3], submissions[5]]) {
      await triggerContestScoring(submission._id, submission);
    }
    assert.strictEqual(await ContestParticipant.findOne({ contestId, userId: fixture.users[0]._id }).then((p) => p.solvedCount), 2);
    assert.strictEqual(jobs.length, 4);
    await processQueuedJobs(jobs);

    const mongoRows = await ContestParticipant.find({ contestId })
      .sort({ solvedCount: -1, totalPenalty: 1, lastAcceptedContestMs: 1, userId: 1 })
      .lean();
    const apiRows = (await readApi(contestId, "?page=1&limit=100")).standings;
    assert.deepStrictEqual(
      apiRows.map(({ userId, solvedCount, penalty }) => [String(userId), solvedCount, penalty]),
      mongoRows.map((row) => [String(row.userId), row.solvedCount, row.totalPenalty]),
    );
    assert.deepStrictEqual(apiRows.map((row) => row.rank), [1, 2, 3]);

    // Duplicate/out-of-order projection jobs converge to one member per user.
    const duplicateJobs = fixture.users.map((user) => ({ contestId, userId: String(user._id) }));
    await processQueuedJobs(duplicateJobs);
    const generation = await redis.get(buildLeaderboardActiveVersionKey(contestId));
    assert.strictEqual(
      await redis.zcard(buildLeaderboardKey(contestId, generation)),
      await ContestParticipant.countDocuments({ contestId }),
    );
    assert.strictEqual(
      await redis.hlen(buildLeaderboardMembersKey(contestId, generation)),
      await ContestParticipant.countDocuments({ contestId }),
    );

    // Redis loss is scoped to this contest, falls back to Mongo, and rebuild restores reads.
    await deleteContestKeys(contestId);
    const fallback = await readApi(contestId);
    assert.deepStrictEqual(fallback.standings, apiRows);
    await rebuild(contestId);
    const recovered = await readApi(contestId);
    assert.deepStrictEqual(recovered.standings, apiRows);

    // A failed projection does not change authoritative Mongo scoring.
    const failingProcessor = createWorkerProcessor({
      ContestModel: Contest,
      ContestParticipantModel: ContestParticipant,
      redis: { get: async () => { throw new Error("injected Redis outage"); } },
    });
    await assert.rejects(
      () => failingProcessor({ data: { contestId, userId: String(fixture.users[0]._id) } }),
      /injected Redis outage/,
    );
    const authoritativeAfterFailure = await ContestParticipant.findOne({
      contestId,
      userId: fixture.users[0]._id,
    }).lean();
    assert.strictEqual(authoritativeAfterFailure.solvedCount, 2);
    await rebuild(contestId);

    // Concurrent rebuilds serialize; rebuild publication remains atomic.
    const rebuildResults = await Promise.all([
      rebuild(contestId),
      rebuild(contestId),
      rebuild(contestId),
    ]);
    assert.ok(rebuildResults.filter((result) => result.status === "published").length >= 1);
    assert.ok(rebuildResults.every((result) => ["published", "already_running"].includes(result.status)));
    const activeGeneration = await redis.get(buildLeaderboardActiveVersionKey(contestId));
    const activeMeta = await redis.hgetall(buildLeaderboardMetaKey(contestId, activeGeneration));
    assert.strictEqual(activeMeta.state, LEADERBOARD_META_STATE.READY);
    assert.strictEqual(activeMeta.health, LEADERBOARD_HEALTH.HEALTHY);

    // Finalization creates the immutable source for finalized reads.
    await Contest.findByIdAndUpdate(contestId, { status: "ENDED" });
    const finalized = await ContestService.finalizeContest({
      contestId,
      actorUserId: fixture.admin._id,
    });
    const snapshotBeforeMutation = JSON.parse(JSON.stringify(finalized.snapshot.standings));
    await ContestParticipant.updateOne(
      { contestId, userId: fixture.users[0]._id },
      { $set: { solvedCount: 99, totalPenalty: 0, lastAcceptedContestMs: 0 } },
    );
    await deleteContestKeys(contestId);
    const finalPage = await readApi(contestId, "?page=1&limit=100");
    assert.deepStrictEqual(
      finalPage.standings.map((row) => ({ ...row, userId: String(row.userId) })),
      snapshotBeforeMutation.map((row) => ({ ...row, userId: String(row.userId) })),
    );
    assert.strictEqual((await ContestService.getMyContestStanding({
      contestId,
      userId: fixture.users[0]._id,
    })).standing.rank, snapshotBeforeMutation.find((row) => String(row.userId) === String(fixture.users[0]._id)).rank);

    // Retention cleanup is idempotent and cannot affect the final snapshot.
    const retention = require("../../backend/services/leaderboard-retention.service").createLeaderboardRetentionService({
      ContestModel: Contest,
      redis,
      config: { finalizedCleanupEnabled: true, finalizedCleanupGraceMs: 0, cleanupKeyScanCount: 100 },
    });
    const cleanup = await retention.cleanupContest(contestId);
    assert.strictEqual(cleanup.status, "cleaned");
    assert.deepStrictEqual((await readApi(contestId)).standings, finalPage.standings);

    console.log("ISSUE-706 integration checks passed: 11 scenarios, 0 failed");
  } finally {
    setLeaderboardProjectionEnqueuer(null);
    await deleteContestKeys(contestId);
    if (server) await new Promise((resolve) => server.close(resolve));
    await closeStandingsRedis();
    await Promise.all([
      queue.jsQueue.close(),
      queue.javaQueue.close(),
      queue.pythonQueue.close(),
      queue.connection.quit(),
    ]);
    await mongoose.disconnect();
    await redis.quit();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
