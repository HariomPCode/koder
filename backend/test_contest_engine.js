const assert = require("assert");
const mongoose = require("mongoose");

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

const User = require("./models/User");
const Question = require("./models/Question");
const Contest = require("./models/Contest");
const ContestParticipant = require("./models/ContestParticipant");
const ContestService = require("./services/contest.service");
const queue = require("./queue");

const DEFAULT_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/koder_phase5_test";

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
  ]);
}

async function runTests() {
  let queueCalls = [];
  const originalEnqueue = queue.enqueueSubmission;
  queue.enqueueSubmission = async ({ submissionId, language, userId, questionId }) => {
    queueCalls.push({ submissionId, language, userId, questionId });
    return { id: submissionId, language };
  };

  try {
    await resetDb();

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

    const adminUser = await User.create({
      firstName: "Contest",
      lastName: "Admin",
      email: "contest.admin@example.com",
      password: "hashed-password",
      role: "admin",
    });

    const participantUser = await User.create({
      firstName: "Contest",
      lastName: "Player",
      email: "contest.player@example.com",
      password: "hashed-password",
    });

    const secondUser = await User.create({
      firstName: "Contest",
      lastName: "Second",
      email: "contest.second@example.com",
      password: "hashed-password",
    });

    const question = await Question.create({
      questionNum: 500,
      title: "Contest Question",
      slug: "contest-question-phase5",
      difficulty: "Easy",
      description: "Solve the contest question.",
      starterCode: [{ language: "javascript", code: "function solve() {}" }],
      functionName: "solve",
      parameters: [{ name: "input", type: "string" }],
      returnType: "string",
      constraints: ["1 <= n <= 10^5"],
      tags: ["contest"],
    });

    const otherQuestion = await Question.create({
      questionNum: 501,
      title: "Other Question",
      slug: "other-question-phase5",
      difficulty: "Medium",
      description: "Other problem.",
      starterCode: [{ language: "javascript", code: "function solve() {}" }],
      functionName: "solve",
      parameters: [{ name: "input", type: "string" }],
      returnType: "string",
      constraints: ["1 <= n <= 10^5"],
      tags: ["contest"],
    });

    await testCase("Contest lifecycle transitions are valid and server-time synchronization works", async () => {
      const now = Date.now();
      const contest = await ContestService.createContest({
        createdBy: adminUser._id,
        payload: {
          title: "Spring Event",
          slug: "spring-event",
          description: "Spring contest",
          registrationOpenTime: new Date(now - 10 * 60 * 1000),
          startTime: new Date(now - 2 * 60 * 1000),
          endTime: new Date(now + 10 * 60 * 1000),
          problems: [{ questionId: question._id, order: 1, points: 100, penaltyMinutes: 5 }],
        },
      });

      await ContestService.transitionContestStatus({
        contestId: contest.contest._id,
        targetStatus: ContestService.CONTEST_STATUS.SCHEDULED,
        actorUserId: adminUser._id,
      });

      const autoSynced = await ContestService.getContestById({ contestId: contest.contest._id });
      assert.strictEqual(autoSynced.contest.status, ContestService.CONTEST_STATUS.RUNNING);
    });

    await testCase("Invalid lifecycle transition is rejected", async () => {
      const contest = await ContestService.createContest({
        createdBy: adminUser._id,
        payload: {
          title: "Forbidden Transition",
          slug: "forbidden-transition",
          description: "Should reject direct transition",
          registrationOpenTime: new Date(Date.now() - 60000),
          startTime: new Date(Date.now() + 120000),
          endTime: new Date(Date.now() + 300000),
          problems: [{ questionId: question._id, order: 1, points: 100, penaltyMinutes: 5 }],
        },
      });

      await assert.rejects(
        () =>
          ContestService.transitionContestStatus({
            contestId: contest.contest._id,
            targetStatus: ContestService.CONTEST_STATUS.RUNNING,
            actorUserId: adminUser._id,
          }),
        /Invalid contest status transition|Contest cannot start before startTime/i,
      );
    });

    await testCase("Registration is unique, open-window enforced, and duplicate registration is safe", async () => {
      const contest = await ContestService.createContest({
        createdBy: adminUser._id,
        payload: {
          title: "Registration Window",
          slug: "registration-window",
          description: "Open registration",
          registrationOpenTime: new Date(Date.now() - 60000),
          startTime: new Date(Date.now() + 10 * 60 * 1000),
          endTime: new Date(Date.now() + 20 * 60 * 1000),
          problems: [{ questionId: question._id, order: 1, points: 100, penaltyMinutes: 5 }],
        },
      });

      await ContestService.transitionContestStatus({
        contestId: contest.contest._id,
        targetStatus: ContestService.CONTEST_STATUS.SCHEDULED,
        actorUserId: adminUser._id,
      });

      const registrationResult = await ContestService.registerParticipant({
        contestId: contest.contest._id,
        userId: participantUser._id,
      });
      assert.strictEqual(registrationResult.registered, true);

      const duplicate = await ContestService.registerParticipant({
        contestId: contest.contest._id,
        userId: participantUser._id,
      });
      assert.strictEqual(duplicate.registered, true);

      const participantCount = await ContestParticipant.countDocuments({ contestId: contest.contest._id });
      assert.strictEqual(participantCount, 1);
    });

    await testCase("Contest problem validation rejects invalid foreign problem IDs", async () => {
      const contest = await ContestService.createContest({
        createdBy: adminUser._id,
        payload: {
          title: "Problem Validation",
          slug: "problem-validation",
          description: "Invalid problems",
          registrationOpenTime: new Date(Date.now() - 60000),
          startTime: new Date(Date.now() + 60 * 1000),
          endTime: new Date(Date.now() + 10 * 60 * 1000),
          problems: [{ questionId: question._id, order: 1, points: 100, penaltyMinutes: 5 }],
        },
      });

      await ContestService.transitionContestStatus({
        contestId: contest.contest._id,
        targetStatus: ContestService.CONTEST_STATUS.SCHEDULED,
        actorUserId: adminUser._id,
      });
      await ContestService.transitionContestStatus({
        contestId: contest.contest._id,
        targetStatus: ContestService.CONTEST_STATUS.REGISTRATION,
        actorUserId: adminUser._id,
      });
      await ContestService.registerParticipant({ contestId: contest.contest._id, userId: secondUser._id });
      await Contest.updateOne(
        { _id: contest.contest._id },
        { $set: { startTime: new Date(Date.now() - 1000), endTime: new Date(Date.now() + 10 * 60 * 1000) } },
      );
      await ContestService.transitionContestStatus({
        contestId: contest.contest._id,
        targetStatus: ContestService.CONTEST_STATUS.RUNNING,
        actorUserId: adminUser._id,
      });

      await assert.rejects(
        () =>
          ContestService.createContestSubmission({
            contestId: contest.contest._id,
            userId: secondUser._id,
            payload: {
              contestProblemId: new mongoose.Types.ObjectId().toString(),
              language: "javascript",
              code: "console.log('hi');",
            },
          }),
        /Invalid contest problem for this contest/i,
      );
    });

    await testCase("Contest submissions are created with server-derived contest time and queue integration", async () => {
      const contest = await ContestService.createContest({
        createdBy: adminUser._id,
        payload: {
          title: "Contest Submission",
          slug: "contest-submission",
          description: "Valid contest submission",
          registrationOpenTime: new Date(Date.now() - 60000),
          startTime: new Date(Date.now() + 60 * 1000),
          endTime: new Date(Date.now() + 10 * 60 * 1000),
          problems: [{ questionId: question._id, order: 1, points: 100, penaltyMinutes: 5 }],
        },
      });

      await ContestService.transitionContestStatus({
        contestId: contest.contest._id,
        targetStatus: ContestService.CONTEST_STATUS.SCHEDULED,
        actorUserId: adminUser._id,
      });
      await ContestService.transitionContestStatus({
        contestId: contest.contest._id,
        targetStatus: ContestService.CONTEST_STATUS.REGISTRATION,
        actorUserId: adminUser._id,
      });
      await ContestService.registerParticipant({ contestId: contest.contest._id, userId: secondUser._id });
      await Contest.updateOne(
        { _id: contest.contest._id },
        { $set: { startTime: new Date(Date.now() - 1000), endTime: new Date(Date.now() + 10 * 60 * 1000) } },
      );
      await ContestService.transitionContestStatus({
        contestId: contest.contest._id,
        targetStatus: ContestService.CONTEST_STATUS.RUNNING,
        actorUserId: adminUser._id,
      });

      const result = await ContestService.createContestSubmission({
        contestId: contest.contest._id,
        userId: secondUser._id,
        payload: {
          contestProblemId: contest.contest.problems[0]._id.toString(),
          language: "javascript",
          code: "console.log('contest');",
        },
      });

      assert.strictEqual(result.status, "processing");
      assert.strictEqual(queueCalls.length > 0, true);

      const savedSubmission = await (await require("./models/Submission")).findById(result.submissionId);
      assert.ok(savedSubmission.submittedAtContestMs >= 0);
      assert.strictEqual(String(savedSubmission.contestId), String(contest.contest._id));
      assert.strictEqual(String(savedSubmission.contestProblemId), String(contest.contest.problems[0]._id));
    });

    await testCase("Finalization is explicit and idempotent", async () => {
      const contest = await ContestService.createContest({
        createdBy: adminUser._id,
        payload: {
          title: "Finalization",
          slug: "finalization",
          description: "Finalize contest",
          registrationOpenTime: new Date(Date.now() - 60000),
          startTime: new Date(Date.now() - 30000),
          endTime: new Date(Date.now() - 1000),
          problems: [{ questionId: question._id, order: 1, points: 100, penaltyMinutes: 5 }],
        },
      });

      await ContestService.transitionContestStatus({
        contestId: contest.contest._id,
        targetStatus: ContestService.CONTEST_STATUS.SCHEDULED,
        actorUserId: adminUser._id,
      });
      await ContestService.transitionContestStatus({
        contestId: contest.contest._id,
        targetStatus: ContestService.CONTEST_STATUS.REGISTRATION,
        actorUserId: adminUser._id,
      });
      await ContestService.transitionContestStatus({
        contestId: contest.contest._id,
        targetStatus: ContestService.CONTEST_STATUS.RUNNING,
        actorUserId: adminUser._id,
      });
      await ContestService.transitionContestStatus({
        contestId: contest.contest._id,
        targetStatus: ContestService.CONTEST_STATUS.ENDED,
        actorUserId: adminUser._id,
      });

      const finalized = await ContestService.finalizeContest({
        contestId: contest.contest._id,
        actorUserId: adminUser._id,
      });
      assert.strictEqual(finalized.contest.status, ContestService.CONTEST_STATUS.FINALIZED);

      const again = await ContestService.finalizeContest({
        contestId: contest.contest._id,
        actorUserId: adminUser._id,
      });
      assert.strictEqual(again.contest.status, ContestService.CONTEST_STATUS.FINALIZED);
    });

    console.log(`\nContest engine checks: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    queue.enqueueSubmission = originalEnqueue;
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

runTests();
