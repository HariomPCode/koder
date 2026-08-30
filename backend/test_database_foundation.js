const assert = require("assert");
const mongoose = require("mongoose");

const User = require("./models/User");
const Question = require("./models/Question");
const Submission = require("./models/Submission");
const Contest = require("./models/Contest");
const ContestParticipant = require("./models/ContestParticipant");
const ContestLeaderboardSnapshot = require("./models/ContestLeaderboardSnapshot");

const DEFAULT_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/koder_phase1_test";

function hasIndex(indexes, expectedKey) {
  const expected = Object.entries(expectedKey)
    .map(([key, value]) => `${key}:${value}`)
    .join(",");

  return Object.values(indexes).some((indexSpec) => {
    const key = Object.fromEntries(Array.isArray(indexSpec) ? indexSpec : []);
    const actual = Object.entries(key)
      .map(([keyName, value]) => `${keyName}:${value}`)
      .join(",");
    return actual === expected;
  });
}

async function resetDb() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DEFAULT_URI);
  }

  await mongoose.connection.db.dropDatabase();
  await Promise.all([
    User.syncIndexes(),
    Question.syncIndexes(),
    Submission.syncIndexes(),
    Contest.syncIndexes(),
    ContestParticipant.syncIndexes(),
    ContestLeaderboardSnapshot.syncIndexes(),
  ]);
}

async function runTests() {
  try {
    await resetDb();

    const userId = new mongoose.Types.ObjectId();
    const questionId = new mongoose.Types.ObjectId();
    const contestId = new mongoose.Types.ObjectId();
    const contestProblemId = new mongoose.Types.ObjectId();
    const otherUserId = new mongoose.Types.ObjectId();

    let passed = 0;
    let failed = 0;

    async function testCase(name, fn) {
      try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed += 1;
      } catch (error) {
        console.log(`  ✗ ${name}`);
        console.log(`    ${error.message}`);
        failed += 1;
      }
    }

    await testCase("User default rating and contest counters", async () => {
      const user = new User({
        firstName: "Contest",
        lastName: "Player",
        email: "contest.player@example.com",
        password: "hashed-password",
      });

      await user.validate();
      assert.strictEqual(user.rating, 1200);
      assert.strictEqual(user.contestsParticipated, 0);
      assert.strictEqual(user.highestRating, 1200);
    });

    await testCase("Question uniqueness and tags index exist", async () => {
      const baseQuestion = {
        questionNum: 101,
        title: "Two Sum",
        slug: "two-sum-phase1",
        difficulty: "Easy",
        description: "Return indices of two numbers adding to target.",
        starterCode: [{ language: "javascript", code: "function twoSum() {}" }],
        functionName: "twoSum",
        parameters: [{ name: "nums", type: "number[]" }],
        returnType: "number[]",
        constraints: ["1 <= nums.length <= 10^5"],
        tags: ["array", "hash-table"],
      };

      await Question.create(baseQuestion);
      await assert.rejects(
        async () => Question.create({ ...baseQuestion, _id: new mongoose.Types.ObjectId() }),
        /duplicate|E11000/i,
      );

      const indexes = await Question.collection.getIndexes();
      assert.ok(hasIndex(indexes, { tags: 1 }), "tags index missing");
    });

    await testCase("Submission supports practice and contest payloads", async () => {
      const practiceSubmission = new Submission({
        userId,
        questionId,
        code: "console.log('hello')",
        language: "javascript",
        status: "pending",
        contestId: null,
        contestProblemId: null,
        submittedAtContestMs: null,
      });

      await practiceSubmission.validate();
      assert.strictEqual(practiceSubmission.contestId, null);
      assert.strictEqual(practiceSubmission.contestProblemId, null);
      assert.strictEqual(practiceSubmission.submittedAtContestMs, null);

      const contestSubmission = new Submission({
        userId,
        questionId,
        contestId,
        contestProblemId,
        submittedAtContestMs: 42000,
        code: "console.log('contest')",
        language: "javascript",
        status: "completed",
        verdict: "Accepted",
      });

      await contestSubmission.validate();
      assert.strictEqual(contestSubmission.contestId.toString(), contestId.toString());
      assert.strictEqual(contestSubmission.contestProblemId.toString(), contestProblemId.toString());
      assert.strictEqual(contestSubmission.submittedAtContestMs, 42000);
    });

    await testCase("Submission status enum accepts target states and rejects invalid ones", async () => {
      for (const status of ["created", "queued", "running", "completed"]) {
        const doc = new Submission({
          userId,
          questionId,
          code: "const x = 1;",
          language: "javascript",
          status,
        });
        await doc.validate();
      }

      const invalid = new Submission({
        userId,
        questionId,
        code: "const x = 1;",
        language: "javascript",
        status: "failed",
      });

      await assert.rejects(() => invalid.validate(), /status/i);
    });

    await testCase("Required Submission indexes exist", async () => {
      const indexes = await Submission.collection.getIndexes();
      assert.ok(hasIndex(indexes, { userId: 1, createdAt: -1 }), "userId+createdAt index missing");
      assert.ok(hasIndex(indexes, { userId: 1, questionId: 1 }), "userId+questionId index missing");
      assert.ok(
        hasIndex(indexes, { contestId: 1, userId: 1, contestProblemId: 1, verdict: 1 }),
        "contest contest+user+problem+verdict index missing",
      );
      assert.ok(hasIndex(indexes, { contestId: 1, status: 1 }), "contestId+status index missing");
      assert.ok(hasIndex(indexes, { status: 1, createdAt: 1 }), "status+createdAt index missing");
    });

    await testCase("Contest validation and embedded problem structure work", async () => {
      const contest = new Contest({
        title: "Spring Contest",
        slug: "spring-contest",
        description: "Early contest",
        registrationOpenTime: new Date("2025-02-10T09:00:00.000Z"),
        startTime: new Date("2025-02-10T10:00:00.000Z"),
        endTime: new Date("2025-02-10T12:00:00.000Z"),
        status: "REGISTRATION",
        problems: [
          {
            questionId,
            order: 1,
            points: 100,
            penaltyMinutes: 5,
          },
        ],
        createdBy: userId,
      });

      await contest.validate();
      assert.strictEqual(contest.status, "REGISTRATION");
      assert.strictEqual(contest.problems[0].questionId.toString(), questionId.toString());
      assert.strictEqual(contest.problems[0].points, 100);
      await contest.save();

      await assert.rejects(
        async () =>
          Contest.create({
            title: "Duplicate slug",
            slug: "spring-contest",
            description: "Another contest",
            registrationOpenTime: new Date("2025-02-11T09:00:00.000Z"),
            startTime: new Date("2025-02-11T10:00:00.000Z"),
            endTime: new Date("2025-02-11T12:00:00.000Z"),
            problems: [{ questionId, order: 1, points: 50, penaltyMinutes: 3 }],
            createdBy: userId,
          }),
        /duplicate|E11000/i,
      );

      const invalidSchedule = new Contest({
        title: "Invalid schedule",
        slug: "invalid-schedule",
        description: "Broken timing",
        registrationOpenTime: new Date("2025-02-12T11:00:00.000Z"),
        startTime: new Date("2025-02-12T10:00:00.000Z"),
        endTime: new Date("2025-02-12T09:00:00.000Z"),
        problems: [{ questionId, order: 1, points: 50, penaltyMinutes: 3 }],
        createdBy: userId,
      });

      await assert.rejects(() => invalidSchedule.validate(), /endTime|registrationOpenTime/i);
    });

    await testCase("ContestParticipant compound registration unique index blocks duplicates", async () => {
      const first = await ContestParticipant.create({
        contestId,
        userId,
        registeredAt: new Date(),
      });

      assert.ok(first._id);

      await assert.rejects(
        async () =>
          ContestParticipant.create({
            contestId,
            userId,
            registeredAt: new Date(),
          }),
        /duplicate|E11000/i,
      );

      const indexes = await ContestParticipant.collection.getIndexes();
      assert.ok(hasIndex(indexes, { contestId: 1, userId: 1 }), "contestId+userId registration index missing");
      assert.ok(hasIndex(indexes, { userId: 1 }), "userId contest-history index missing");
    });

    await testCase("ContestLeaderboardSnapshot stores standings and has the required indexes", async () => {
      const snapshot = new ContestLeaderboardSnapshot({
        contestId,
        takenAt: new Date("2025-02-10T11:30:00.000Z"),
        isFinal: false,
        standings: [
          {
            userId,
            rank: 1,
            solvedCount: 3,
            score: 2400,
            penalty: 120,
            lastAcceptedAt: new Date("2025-02-10T11:24:00.000Z"),
          },
          {
            userId: otherUserId,
            rank: 2,
            solvedCount: 2,
            score: 2000,
            penalty: 210,
            lastAcceptedAt: new Date("2025-02-10T11:20:00.000Z"),
          },
        ],
      });

      await snapshot.validate();
      assert.strictEqual(snapshot.standings[0].rank, 1);

      const indexes = await ContestLeaderboardSnapshot.collection.getIndexes();
      assert.ok(hasIndex(indexes, { contestId: 1, isFinal: 1 }), "contestId+isFinal index missing");
      assert.ok(hasIndex(indexes, { contestId: 1, takenAt: -1 }), "contestId+takenAt index missing");
    });

    console.log(`\n${passed} passed, ${failed} failed`);

    if (failed > 0) {
      throw new Error(`${failed} database foundation checks failed`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
