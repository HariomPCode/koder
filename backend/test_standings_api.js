const assert = require("assert");
const http = require("http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-standings-608";
process.env.NODE_ENV = "test";

const queuePath = require.resolve("./queue");
require.cache[queuePath] = {
  id: queuePath,
  filename: queuePath,
  loaded: true,
  exports: {
    connection: { quit: async () => {}, disconnect: () => {} },
    jsQueue: { add: async () => ({ id: "js-job-1" }) },
    javaQueue: { add: async () => ({ id: "java-job-1" }) },
    pythonQueue: { add: async () => ({ id: "python-job-1" }) },
    enqueueSubmission: async () => ({ id: "mock-job" }),
    queueMap: {},
    buildQueueJobId: () => "mock-job-id",
  },
};

const createApp = require("./app");
const User = require("./models/User");
const Question = require("./models/Question");
const Contest = require("./models/Contest");
const ContestParticipant = require("./models/ContestParticipant");
const ContestParticipantProblem = require("./models/ContestParticipantProblem");
const ContestScoredSubmission = require("./models/ContestScoredSubmission");
const ContestLeaderboardSnapshot = require("./models/ContestLeaderboardSnapshot");
const ContestFinalizationAudit = require("./models/ContestFinalizationAudit");
const Submission = require("./models/Submission");
const ContestService = require("./services/contest.service");
const ScoringService = require("./services/scoring.service");
const { assignCompetitionRanks, compareParticipantStandings, SUBMISSION_STATUS, JUDGE_VERDICTS } = require("@koder/shared");

const DEFAULT_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/koder_standings_test";

let server;
let baseUrl;

function generateToken(userId) {
  return jwt.sign({ userId: String(userId) }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

async function resetDb() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DEFAULT_URI);
  }
  await mongoose.connection.db.dropDatabase();
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

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function testCase(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.error(`    ${error.message}`);
      if (error.stack) {
        console.error(error.stack.split("\n").slice(1, 4).join("\n"));
      }
      failed += 1;
    }
  }

  try {
    await resetDb();

    const app = createApp();
    server = app.listen(0);
    server.unref();
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const adminUser = await User.create({
      firstName: "Admin",
      lastName: "Master",
      email: "admin.standings@example.com",
      password: "hashed-password",
      role: "admin",
    });

    const user1 = await User.create({
      firstName: "Alice",
      lastName: "Coder",
      email: "alice@example.com",
      password: "hashed-password",
      role: "user",
    });

    const user2 = await User.create({
      firstName: "Bob",
      lastName: "Hacker",
      email: "bob@example.com",
      password: "hashed-password",
      role: "user",
    });

    const user3 = await User.create({
      firstName: "Charlie",
      lastName: "Dev",
      email: "charlie@example.com",
      password: "hashed-password",
      role: "user",
    });

    const user4 = await User.create({
      firstName: "Diana",
      lastName: "Engineer",
      email: "diana@example.com",
      password: "hashed-password",
      role: "user",
    });

    const nonParticipant = await User.create({
      firstName: "Eve",
      lastName: "Outsider",
      email: "eve.outsider@example.com",
      password: "hashed-password",
      role: "user",
    });

    const question1 = await Question.create({
      questionNum: 950,
      title: "Problem One",
      slug: "problem-one-standings",
      difficulty: "Easy",
      description: "Problem 1",
      starterCode: [{ language: "javascript", code: "function solve() {}" }],
      functionName: "solve",
      parameters: [{ name: "input", type: "string" }],
      returnType: "string",
      constraints: ["1 <= n <= 100"],
      tags: ["standings"],
    });

    const question2 = await Question.create({
      questionNum: 951,
      title: "Problem Two",
      slug: "problem-two-standings",
      difficulty: "Medium",
      description: "Problem 2",
      starterCode: [{ language: "javascript", code: "function solve() {}" }],
      functionName: "solve",
      parameters: [{ name: "input", type: "string" }],
      returnType: "string",
      constraints: ["1 <= n <= 100"],
      tags: ["standings"],
    });

    console.log("Starting ISSUE-608 Standings API tests...\n");

    // =======================================================================
    // 1. PUBLIC STANDINGS ACCESS WHERE ALLOWED (RUNNING, ENDED, FINALIZED)
    // =======================================================================
    await testCase("1. Public standings access allowed for RUNNING contest (no auth header/cookie)", async () => {
      const now = Date.now();
      const contest = await Contest.create({
        title: "Running Contest Public",
        slug: "running-contest-public",
        description: "Public standings test",
        registrationOpenTime: new Date(now - 3600000),
        startTime: new Date(now - 1800000),
        endTime: new Date(now + 1800000),
        status: "RUNNING",
        createdBy: adminUser._id,
        problems: [
          { questionId: question1._id, order: 1, points: 100, penaltyMinutes: 5 },
        ],
      });

      await ContestParticipant.create({
        contestId: contest._id,
        userId: user1._id,
        registeredAt: new Date(now - 2000000),
        solvedCount: 1,
        totalPenalty: 15,
        lastAcceptedContestMs: 900000,
      });

      const res = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(String(data.contestId), String(contest._id));
      assert.strictEqual(data.status, "RUNNING");
      assert.strictEqual(data.standings.length, 1);
      assert.strictEqual(String(data.standings[0].userId), String(user1._id));
      assert.strictEqual(data.standings[0].rank, 1);
      assert.strictEqual(data.standings[0].solvedCount, 1);
      assert.strictEqual(data.standings[0].score, 1);
      assert.strictEqual(data.standings[0].penalty, 15);
      assert.ok(data.standings[0].lastAcceptedAt);
      assert.strictEqual(data.pagination.page, 1);
      assert.strictEqual(data.pagination.limit, 50);
      assert.strictEqual(data.pagination.total, 1);
    });

    await testCase("1b. Public standings access allowed for ENDED contest", async () => {
      const now = Date.now();
      const contest = await Contest.create({
        title: "Ended Contest Public",
        slug: "ended-contest-public",
        description: "Ended public standings",
        registrationOpenTime: new Date(now - 7200000),
        startTime: new Date(now - 3600000),
        endTime: new Date(now - 60000),
        status: "ENDED",
        createdBy: adminUser._id,
        problems: [{ questionId: question1._id, order: 1, points: 100, penaltyMinutes: 5 }],
      });

      const res = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, "ENDED");
      assert.strictEqual(data.standings.length, 0);
      assert.strictEqual(data.pagination.total, 0);
    });

    // =======================================================================
    // 2. CONTEST VISIBILITY & LIFECYCLE RESTRICTIONS
    // =======================================================================
    await testCase("2. Standings rejected for DRAFT contest with 404", async () => {
      const now = Date.now();
      const contest = await Contest.create({
        title: "Draft Contest",
        slug: "draft-contest-standings",
        description: "Draft contest",
        registrationOpenTime: new Date(now + 3600000),
        startTime: new Date(now + 7200000),
        endTime: new Date(now + 10800000),
        status: "DRAFT",
        createdBy: adminUser._id,
        problems: [],
      });

      const publicRes = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings`);
      assert.strictEqual(publicRes.status, 404);
      const publicData = await publicRes.json();
      assert.match(publicData.message, /not found/i);

      const token = generateToken(user1._id);
      const meRes = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings/me`, {
        headers: { Cookie: `auth_token=${token}` },
      });
      assert.strictEqual(meRes.status, 404);
    });

    await testCase("2b. Standings rejected for SCHEDULED / REGISTRATION contest before start", async () => {
      const now = Date.now();
      const scheduledContest = await Contest.create({
        title: "Scheduled Contest",
        slug: "scheduled-contest-standings",
        description: "Scheduled",
        registrationOpenTime: new Date(now + 1800000),
        startTime: new Date(now + 3600000),
        endTime: new Date(now + 7200000),
        status: "SCHEDULED",
        createdBy: adminUser._id,
        problems: [],
      });

      const resScheduled = await fetch(`${baseUrl}/api/v1/contests/${scheduledContest._id}/standings`);
      assert.strictEqual(resScheduled.status, 400);
      const dataScheduled = await resScheduled.json();
      assert.match(dataScheduled.message, /not available/i);

      const regContest = await Contest.create({
        title: "Registration Contest",
        slug: "registration-contest-standings",
        description: "Registration open",
        registrationOpenTime: new Date(now - 60000),
        startTime: new Date(now + 3600000),
        endTime: new Date(now + 7200000),
        status: "REGISTRATION",
        createdBy: adminUser._id,
        problems: [],
      });

      const resReg = await fetch(`${baseUrl}/api/v1/contests/${regContest._id}/standings`);
      assert.strictEqual(resReg.status, 400);
      const dataReg = await resReg.json();
      assert.match(dataReg.message, /not available/i);

      const token = generateToken(user1._id);
      const meRes = await fetch(`${baseUrl}/api/v1/contests/${regContest._id}/standings/me`, {
        headers: { Cookie: `auth_token=${token}` },
      });
      assert.strictEqual(meRes.status, 400);
    });

    await testCase("2c. Non-existent contest returns 404", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await fetch(`${baseUrl}/api/v1/contests/${fakeId}/standings`);
      assert.strictEqual(res.status, 404);

      const token = generateToken(user1._id);
      const meRes = await fetch(`${baseUrl}/api/v1/contests/${fakeId}/standings/me`, {
        headers: { Cookie: `auth_token=${token}` },
      });
      assert.strictEqual(meRes.status, 404);
    });

    // =======================================================================
    // 3. AUTHENTICATED /standings/me & UNAUTHENTICATED REJECTION
    // =======================================================================
    await testCase("3. /standings/me requires authentication (401 without cookie)", async () => {
      const now = Date.now();
      const contest = await Contest.create({
        title: "Auth Contest",
        slug: "auth-check-contest-608",
        description: "Auth check",
        registrationOpenTime: new Date(now - 3600000),
        startTime: new Date(now - 1800000),
        endTime: new Date(now + 1800000),
        status: "RUNNING",
        createdBy: adminUser._id,
        problems: [],
      });

      const unauthRes = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings/me`);
      assert.strictEqual(unauthRes.status, 401);
      const data = await unauthRes.json();
      assert.match(data.message, /unauthenticated/i);
    });

    await testCase("3b. /standings/me rejects invalid/expired JWT token (403)", async () => {
      const now = Date.now();
      const contest = await Contest.create({
        title: "Invalid JWT Contest",
        slug: "invalid-jwt-contest",
        description: "Invalid JWT check",
        registrationOpenTime: new Date(now - 3600000),
        startTime: new Date(now - 1800000),
        endTime: new Date(now + 1800000),
        status: "RUNNING",
        createdBy: adminUser._id,
        problems: [],
      });

      const invalidToken = "invalid.token.here";
      const res = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings/me`, {
        headers: { Cookie: `auth_token=${invalidToken}` },
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.match(data.message, /invalid or expired/i);
    });

    await testCase("3c. /standings/me returns 404 for authenticated user not registered in contest", async () => {
      const now = Date.now();
      const contest = await Contest.create({
        title: "Not Registered Contest",
        slug: "not-registered-contest",
        description: "Non-participant check",
        registrationOpenTime: new Date(now - 3600000),
        startTime: new Date(now - 1800000),
        endTime: new Date(now + 1800000),
        status: "RUNNING",
        createdBy: adminUser._id,
        problems: [],
      });

      const token = generateToken(nonParticipant._id);
      const res = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings/me`, {
        headers: { Cookie: `auth_token=${token}` },
      });
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.match(data.message, /participant not registered/i);
    });

    await testCase("3d. /standings/me returns authenticated participant's authoritative standing", async () => {
      const now = Date.now();
      const contest = await Contest.create({
        title: "Standing Me Contest",
        slug: "standing-me-contest",
        description: "My standing test",
        registrationOpenTime: new Date(now - 3600000),
        startTime: new Date(now - 1800000),
        endTime: new Date(now + 1800000),
        status: "RUNNING",
        createdBy: adminUser._id,
        problems: [{ questionId: question1._id, order: 1, points: 100, penaltyMinutes: 5 }],
      });

      await ContestParticipant.create({
        contestId: contest._id,
        userId: user1._id,
        registeredAt: new Date(now - 2000000),
        solvedCount: 1,
        totalPenalty: 25,
        lastAcceptedContestMs: 600000,
      });

      const token = generateToken(user1._id);
      const res = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings/me`, {
        headers: { Cookie: `auth_token=${token}` },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(String(data.contestId), String(contest._id));
      assert.strictEqual(String(data.standing.userId), String(user1._id));
      assert.strictEqual(data.standing.rank, 1);
      assert.strictEqual(data.standing.solvedCount, 1);
      assert.strictEqual(data.standing.score, 1);
      assert.strictEqual(data.standing.penalty, 25);
      assert.ok(data.standing.lastAcceptedAt);
    });

    // =======================================================================
    // 4. NO CLIENT-CONTROLLED IDENTITY
    // =======================================================================
    await testCase("4. /standings/me ignores client-supplied userId in query or body", async () => {
      const now = Date.now();
      const contest = await Contest.create({
        title: "Identity Protection Contest",
        slug: "identity-protection-contest",
        description: "Test client-controlled identity refusal",
        registrationOpenTime: new Date(now - 3600000),
        startTime: new Date(now - 1800000),
        endTime: new Date(now + 1800000),
        status: "RUNNING",
        createdBy: adminUser._id,
        problems: [],
      });

      // user1 has 2 solves, rank 1
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user1._id,
        registeredAt: new Date(now - 2000000),
        solvedCount: 2,
        totalPenalty: 30,
        lastAcceptedContestMs: 500000,
      });

      // user2 has 1 solve, rank 2
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user2._id,
        registeredAt: new Date(now - 2000000),
        solvedCount: 1,
        totalPenalty: 10,
        lastAcceptedContestMs: 400000,
      });

      // User 2 logs in, but tries to forge identity as User 1 via query params: ?userId=user1._id
      const tokenUser2 = generateToken(user2._id);
      const res = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings/me?userId=${user1._id}`, {
        headers: { Cookie: `auth_token=${tokenUser2}` },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      // MUST return User 2's standing, not User 1
      assert.strictEqual(String(data.standing.userId), String(user2._id));
      assert.strictEqual(data.standing.rank, 2);
      assert.strictEqual(data.standing.solvedCount, 1);
    });

    // =======================================================================
    // 5. DETERMINISTIC ICPC ORDERING CONTRACT
    // =======================================================================
    await testCase("5. Deterministic ICPC ordering: solvedCount DESC, totalPenalty ASC, lastAcceptedContestMs ASC, userId ASC", async () => {
      const now = Date.now();
      const contest = await Contest.create({
        title: "ICPC Ordering Contest",
        slug: "icpc-ordering-contest-608",
        description: "Test ordering contract",
        registrationOpenTime: new Date(now - 3600000),
        startTime: new Date(now - 1800000),
        endTime: new Date(now + 1800000),
        status: "RUNNING",
        createdBy: adminUser._id,
        problems: [],
      });

      // Distinct IDs with controlled lexicographical order
      const idA = new mongoose.Types.ObjectId("111111111111111111111111");
      const idB = new mongoose.Types.ObjectId("222222222222222222222222");
      const idC = new mongoose.Types.ObjectId("333333333333333333333333");
      const idD = new mongoose.Types.ObjectId("444444444444444444444444");
      const idE = new mongoose.Types.ObjectId("555555555555555555555555");
      const idF = new mongoose.Types.ObjectId("666666666666666666666666");

      // Participant A: 3 solved -> rank 1 (solvedCount DESC)
      // Participant B: 2 solved, penalty 40 -> rank 2 (penalty ASC)
      // Participant C: 2 solved, penalty 50, last 10000 -> rank 3 (lastAccepted ASC)
      // Participant D: 2 solved, penalty 50, last 20000 -> rank 4 (lastAccepted ASC)
      // Participant E: 2 solved, penalty 50, last 20000, id E -> rank 5 (userId ASC tiebreak)
      // Participant F: 2 solved, penalty 50, last 20000, id F -> rank 6 (userId ASC tiebreak)
      // Note: idF > idE lexicographically

      // Insert in intentionally shuffled order to prove database/scoring sort
      await ContestParticipant.create([
        { contestId: contest._id, userId: idF, solvedCount: 2, totalPenalty: 50, lastAcceptedContestMs: 20000 },
        { contestId: contest._id, userId: idA, solvedCount: 3, totalPenalty: 120, lastAcceptedContestMs: 30000 },
        { contestId: contest._id, userId: idD, solvedCount: 2, totalPenalty: 50, lastAcceptedContestMs: 20000 },
        { contestId: contest._id, userId: idC, solvedCount: 2, totalPenalty: 50, lastAcceptedContestMs: 10000 },
        { contestId: contest._id, userId: idE, solvedCount: 2, totalPenalty: 50, lastAcceptedContestMs: 20000 },
        { contestId: contest._id, userId: idB, solvedCount: 2, totalPenalty: 40, lastAcceptedContestMs: 90000 },
      ]);

      const res = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings?limit=10`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.standings.length, 6);

      // Expected order: idA (rank 1), idB (rank 2), idC (rank 3), idD (rank 4), idE (rank 5), idF (rank 6)
      const returnedIds = data.standings.map((s) => String(s.userId));
      assert.deepStrictEqual(returnedIds, [
        String(idA),
        String(idB),
        String(idC),
        String(idD),
        String(idE),
        String(idF),
      ]);

      const returnedRanks = data.standings.map((s) => s.rank);
      assert.deepStrictEqual(returnedRanks, [1, 2, 3, 4, 5, 6]);
    });

    // =======================================================================
    // 6. COMPETITION RANK BEHAVIOR INCLUDING TIES
    // =======================================================================
    await testCase("6. Competition rank behavior with ties", async () => {
      const sameUserId = new mongoose.Types.ObjectId("777777777777777777777777");
      const otherUser = new mongoose.Types.ObjectId("888888888888888888888888");

      // Verify existing assignCompetitionRanks contract on tie inputs:
      const testEntries = [
        { userId: sameUserId, solvedCount: 2, totalPenalty: 100, lastAcceptedContestMs: 5000 },
        { userId: sameUserId, solvedCount: 2, totalPenalty: 100, lastAcceptedContestMs: 5000 },
        { userId: otherUser, solvedCount: 1, totalPenalty: 50, lastAcceptedContestMs: 1000 },
      ];
      const ranked = assignCompetitionRanks(testEntries);
      assert.deepStrictEqual(
        ranked.map((e) => e.rank),
        [1, 1, 3],
      );
    });

    // =======================================================================
    // 7. PAGINATION BEHAVIOR
    // =======================================================================
    await testCase("7. Pagination behavior across multiple pages with correct global ranks", async () => {
      const now = Date.now();
      const contest = await Contest.create({
        title: "Pagination Contest",
        slug: "pagination-contest-608",
        description: "Test pagination",
        registrationOpenTime: new Date(now - 3600000),
        startTime: new Date(now - 1800000),
        endTime: new Date(now + 1800000),
        status: "RUNNING",
        createdBy: adminUser._id,
        problems: [],
      });

      // Create 5 participants with 5, 4, 3, 2, 1 solves
      const users = [];
      for (let i = 1; i <= 5; i++) {
        const u = new mongoose.Types.ObjectId(`${i.toString().padStart(24, "0")}`);
        users.push(u);
        await ContestParticipant.create({
          contestId: contest._id,
          userId: u,
          solvedCount: 6 - i,
          totalPenalty: 10 * i,
          lastAcceptedContestMs: 1000 * i,
        });
      }

      // Page 1: limit 2 -> ranks 1, 2
      const page1Res = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings?page=1&limit=2`);
      assert.strictEqual(page1Res.status, 200);
      const p1 = await page1Res.json();
      assert.strictEqual(p1.standings.length, 2);
      assert.strictEqual(p1.standings[0].rank, 1);
      assert.strictEqual(String(p1.standings[0].userId), String(users[0]));
      assert.strictEqual(p1.standings[1].rank, 2);
      assert.strictEqual(String(p1.standings[1].userId), String(users[1]));
      assert.strictEqual(p1.pagination.page, 1);
      assert.strictEqual(p1.pagination.limit, 2);
      assert.strictEqual(p1.pagination.total, 5);
      assert.strictEqual(p1.pagination.totalPages, 3);

      // Page 2: limit 2 -> ranks 3, 4 (GLOBAL RANKS, NOT 1, 2!)
      const page2Res = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings?page=2&limit=2`);
      assert.strictEqual(page2Res.status, 200);
      const p2 = await page2Res.json();
      assert.strictEqual(p2.standings.length, 2);
      assert.strictEqual(p2.standings[0].rank, 3);
      assert.strictEqual(String(p2.standings[0].userId), String(users[2]));
      assert.strictEqual(p2.standings[1].rank, 4);
      assert.strictEqual(String(p2.standings[1].userId), String(users[3]));
      assert.strictEqual(p2.pagination.page, 2);

      // Page 3: limit 2 -> rank 5
      const page3Res = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings?page=3&limit=2`);
      assert.strictEqual(page3Res.status, 200);
      const p3 = await page3Res.json();
      assert.strictEqual(p3.standings.length, 1);
      assert.strictEqual(p3.standings[0].rank, 5);
      assert.strictEqual(String(p3.standings[0].userId), String(users[4]));

      // Page 4: empty standings
      const page4Res = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings?page=4&limit=2`);
      assert.strictEqual(page4Res.status, 200);
      const p4 = await page4Res.json();
      assert.strictEqual(p4.standings.length, 0);
      assert.strictEqual(p4.pagination.total, 5);

      // Clamped pagination: page=-1 -> 1, limit=999 -> 100
      const clampedRes = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings?page=-1&limit=999`);
      assert.strictEqual(clampedRes.status, 200);
      const pClamped = await clampedRes.json();
      assert.strictEqual(pClamped.pagination.page, 1);
      assert.strictEqual(pClamped.pagination.limit, 100);
      assert.strictEqual(pClamped.standings.length, 5);
    });

    // =======================================================================
    // 8. FINALIZED CONTEST READS FROM FINAL SNAPSHOT & IMMUTABILITY
    // =======================================================================
    await testCase("8. Finalized contest reads from immutable final snapshot, not live aggregates or submissions", async () => {
      const now = Date.now();
      const contest = await Contest.create({
        title: "Finalized Contest Standings",
        slug: "finalized-contest-standings",
        description: "Final snapshot read check",
        registrationOpenTime: new Date(now - 7200000),
        startTime: new Date(now - 3600000),
        endTime: new Date(now - 60000),
        status: "ENDED",
        createdBy: adminUser._id,
        problems: [
          { questionId: question1._id, order: 1, points: 100, penaltyMinutes: 5 },
          { questionId: question2._id, order: 2, points: 200, penaltyMinutes: 10 },
        ],
      });

      // user1 solved problem 1
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user1._id,
        registeredAt: new Date(now - 7000000),
      });
      await Submission.create({
        userId: user1._id,
        questionId: question1._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 600000,
        code: "function solve() {}",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      // user2 solved problem 1 and 2
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user2._id,
        registeredAt: new Date(now - 7000000),
      });
      await Submission.create({
        userId: user2._id,
        questionId: question1._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 600000,
        code: "function solve() {}",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      await Submission.create({
        userId: user2._id,
        questionId: question2._id,
        contestId: contest._id,
        contestProblemId: contest.problems[1]._id,
        submittedAtContestMs: 1200000,
        code: "function solve() {}",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      // Finalize contest via ContestService (ISSUE-607 integration)
      const finalizeResult = await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
      });
      assert.strictEqual(finalizeResult.contest.status, "FINALIZED");
      assert.ok(finalizeResult.snapshot.isFinal);

      // 1. Read public standings - must come from snapshot
      const publicRes = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings`);
      assert.strictEqual(publicRes.status, 200);
      const publicData = await publicRes.json();
      assert.strictEqual(publicData.status, "FINALIZED");
      assert.strictEqual(publicData.standings.length, 2);
      assert.strictEqual(String(publicData.standings[0].userId), String(user2._id));
      assert.strictEqual(publicData.standings[0].rank, 1);
      assert.strictEqual(String(publicData.standings[1].userId), String(user1._id));
      assert.strictEqual(publicData.standings[1].rank, 2);

      // 2. Read /standings/me for user1
      const token1 = generateToken(user1._id);
      const meRes1 = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings/me`, {
        headers: { Cookie: `auth_token=${token1}` },
      });
      assert.strictEqual(meRes1.status, 200);
      const meData1 = await meRes1.json();
      assert.strictEqual(String(meData1.standing.userId), String(user1._id));
      assert.strictEqual(meData1.standing.rank, 2);
      assert.strictEqual(meData1.standing.solvedCount, 1);

      // 3. Simulate post-finalization live data drift:
      // Directly mutate ContestParticipant aggregate to 99 solves
      await ContestParticipant.updateOne(
        { contestId: contest._id, userId: user1._id },
        { $set: { solvedCount: 99, totalPenalty: 999 } },
      );

      // Standings API MUST STILL return snapshot values (1 solve, rank 2), NOT mutated live value (99)!
      const driftedPublicRes = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings`);
      const driftedData = await driftedPublicRes.json();
      const user1Standing = driftedData.standings.find((s) => String(s.userId) === String(user1._id));
      assert.strictEqual(user1Standing.solvedCount, 1, "Standings must read from immutable snapshot!");
      assert.strictEqual(user1Standing.rank, 2);

      const driftedMeRes = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings/me`, {
        headers: { Cookie: `auth_token=${token1}` },
      });
      const driftedMeData = await driftedMeRes.json();
      assert.strictEqual(driftedMeData.standing.solvedCount, 1, "/standings/me must read from immutable snapshot!");
      assert.strictEqual(driftedMeData.standing.rank, 2);

      // 4. Verify snapshot immutability
      const snapshotDoc = await ContestLeaderboardSnapshot.findById(finalizeResult.snapshot._id);
      snapshotDoc.standings[0].score = 999;
      await assert.rejects(async () => {
        await snapshotDoc.save();
      }, /immutable/i);
    });

    // =======================================================================
    // 9. NON-PARTICIPANT LOOKUP IN FINALIZED CONTEST
    // =======================================================================
    await testCase("9. Non-participant in finalized contest returns 404", async () => {
      const contest = await Contest.findOne({ status: "FINALIZED" });
      assert.ok(contest, "Must have a finalized contest from previous test");

      const tokenOutsider = generateToken(nonParticipant._id);
      const res = await fetch(`${baseUrl}/api/v1/contests/${contest._id}/standings/me`, {
        headers: { Cookie: `auth_token=${tokenOutsider}` },
      });
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.match(data.message, /participant not registered/i);
    });

    // =======================================================================
    // 10. REGRESSION: PRACTICE SUBMISSIONS AND NORMAL WORKFLOW UNAFFECTED
    // =======================================================================
    await testCase("10. Practice submission behavior remains unaffected by standings API", async () => {
      const practiceSub = await Submission.create({
        userId: user1._id,
        questionId: question1._id,
        contestId: null,
        contestProblemId: null,
        submittedAtContestMs: null,
        code: "function solve() { return 'ok'; }",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
        passedTestCases: 1,
        totalTestCases: 1,
      });

      assert.strictEqual(practiceSub.contestId, null);
      assert.strictEqual(practiceSub.status, SUBMISSION_STATUS.COMPLETED);
    });

    console.log(`\n=======================================================`);
    console.log(`ISSUE-608 standings test summary: ${passed} passed, ${failed} failed`);
    console.log(`=======================================================\n`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

runTests();
