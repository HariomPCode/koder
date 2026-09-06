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
const ContestParticipantProblem = require("./models/ContestParticipantProblem");
const ContestScoredSubmission = require("./models/ContestScoredSubmission");
const ContestLeaderboardSnapshot = require("./models/ContestLeaderboardSnapshot");
const ContestFinalizationAudit = require("./models/ContestFinalizationAudit");
const Submission = require("./models/Submission");
const ContestService = require("./services/contest.service");
const ScoringService = require("./services/scoring.service");
const { updateSubmission } = require("@koder/shared");
const { SUBMISSION_STATUS, JUDGE_VERDICTS } = require("@koder/shared");

const DEFAULT_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/koder_finalization_test";

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
      failed += 1;
    }
  }

  try {
    await resetDb();

    const adminUser = await User.create({
      firstName: "Admin",
      lastName: "User",
      email: "admin.finalization@example.com",
      password: "hashed-password",
      role: "admin",
    });

    const regularUser = await User.create({
      firstName: "Regular",
      lastName: "User",
      email: "regular.finalization@example.com",
      password: "hashed-password",
      role: "user",
    });

    const participant1 = await User.create({
      firstName: "Participant",
      lastName: "One",
      email: "p1.finalization@example.com",
      password: "hashed-password",
      role: "user",
    });

    const participant2 = await User.create({
      firstName: "Participant",
      lastName: "Two",
      email: "p2.finalization@example.com",
      password: "hashed-password",
      role: "user",
    });

    const questionA = await Question.create({
      questionNum: 901,
      title: "Question A",
      slug: "question-a-finalization",
      difficulty: "Easy",
      description: "Solve Question A",
      starterCode: [{ language: "javascript", code: "function solve() {}" }],
      functionName: "solve",
      parameters: [{ name: "input", type: "string" }],
      returnType: "string",
      constraints: ["1 <= n <= 100"],
      tags: ["contest"],
    });

    const questionB = await Question.create({
      questionNum: 902,
      title: "Question B",
      slug: "question-b-finalization",
      difficulty: "Medium",
      description: "Solve Question B",
      starterCode: [{ language: "javascript", code: "function solve() {}" }],
      functionName: "solve",
      parameters: [{ name: "input", type: "string" }],
      returnType: "string",
      constraints: ["1 <= n <= 100"],
      tags: ["contest"],
    });

    async function setupEndedContest({ slug = "ended-contest-" + Date.now(), participants = [] } = {}) {
      const contest = await Contest.create({
        title: "Test Contest " + slug,
        slug,
        description: "Contest for finalization tests",
        registrationOpenTime: new Date(Date.now() - 3600000),
        startTime: new Date(Date.now() - 1800000),
        endTime: new Date(Date.now() - 60000),
        status: "ENDED",
        problems: [
          { questionId: questionA._id, order: 1, points: 100, penaltyMinutes: 5 },
          { questionId: questionB._id, order: 2, points: 200, penaltyMinutes: 10 },
        ],
        createdBy: adminUser._id,
      });

      for (const p of participants) {
        await ContestParticipant.create({
          contestId: contest._id,
          userId: p._id,
          registeredAt: new Date(Date.now() - 3000000),
        });
      }

      return contest;
    }

    console.log("Starting ISSUE-607 contest finalization tests...\n");

    // 1. Normal finalization with zero pending/running submissions.
    await testCase("1. Normal finalization with zero pending/running submissions", async () => {
      const contest = await setupEndedContest({ slug: "zero-pending-contest" });
      const result = await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
      });

      assert.strictEqual(result.contest.status, "FINALIZED");
      assert.ok(result.snapshot, "snapshot must be returned");
      assert.strictEqual(result.snapshot.isFinal, true);

      const dbContest = await Contest.findById(contest._id);
      assert.strictEqual(dbContest.status, "FINALIZED");

      const snapshots = await ContestLeaderboardSnapshot.find({ contestId: contest._id, isFinal: true });
      assert.strictEqual(snapshots.length, 1);
    });

    // 2. Normal finalization blocked when a submission is queued.
    await testCase("2. Normal finalization blocked when a submission is queued", async () => {
      const contest = await setupEndedContest({ slug: "queued-pending-contest", participants: [participant1] });
      await Submission.create({
        userId: participant1._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 10000,
        code: "function solve() {}",
        language: "javascript",
        status: SUBMISSION_STATUS.QUEUED,
      });

      await assert.rejects(
        async () => {
          await ContestService.finalizeContest({
            contestId: contest._id,
            actorUserId: adminUser._id,
            force: false,
          });
        },
        /pending submission/i,
      );

      const dbContest = await Contest.findById(contest._id);
      assert.strictEqual(dbContest.status, "ENDED");
      const snapshots = await ContestLeaderboardSnapshot.find({ contestId: contest._id, isFinal: true });
      assert.strictEqual(snapshots.length, 0);
    });

    // 3. Normal finalization blocked when a submission is running.
    await testCase("3. Normal finalization blocked when a submission is running", async () => {
      const contest = await setupEndedContest({ slug: "running-pending-contest", participants: [participant1] });
      await Submission.create({
        userId: participant1._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 12000,
        code: "function solve() {}",
        language: "javascript",
        status: SUBMISSION_STATUS.RUNNING,
      });

      await assert.rejects(
        async () => {
          await ContestService.finalizeContest({
            contestId: contest._id,
            actorUserId: adminUser._id,
            force: false,
          });
        },
        /pending submission/i,
      );

      const dbContest = await Contest.findById(contest._id);
      assert.strictEqual(dbContest.status, "ENDED");
      const snapshots = await ContestLeaderboardSnapshot.find({ contestId: contest._id, isFinal: true });
      assert.strictEqual(snapshots.length, 0);
    });

    // 4. Force-finalization requires admin authorization.
    await testCase("4. Force-finalization requires admin authorization", async () => {
      const contest = await setupEndedContest({ slug: "auth-check-contest" });
      await assert.rejects(
        async () => {
          await ContestService.finalizeContest({
            contestId: contest._id,
            actorUserId: regularUser._id,
            force: true,
            reason: "emergency finalize",
          });
        },
        /admins may finalize/i,
      );
    });

    // 5. Force-finalization requires force=true.
    await testCase("5. Force-finalization requires force=true", async () => {
      const contest = await setupEndedContest({ slug: "force-bool-contest", participants: [participant1] });
      await Submission.create({
        userId: participant1._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 15000,
        code: "function solve() {}",
        language: "javascript",
        status: SUBMISSION_STATUS.RUNNING,
      });

      // Passing force: false or missing force with pending submissions must fail
      await assert.rejects(
        async () => {
          await ContestService.finalizeContest({
            contestId: contest._id,
            actorUserId: adminUser._id,
            force: false,
            reason: "test reason",
          });
        },
        /pending submission/i,
      );

      await assert.rejects(
        async () => {
          await ContestService.finalizeContest({
            contestId: contest._id,
            actorUserId: adminUser._id,
            force: null,
            reason: "test reason",
          });
        },
        /pending submission/i,
      );
    });

    // 6. Force-finalization requires a non-empty reason.
    await testCase("6. Force-finalization requires a non-empty reason", async () => {
      const contest = await setupEndedContest({ slug: "force-reason-contest", participants: [participant1] });
      await Submission.create({
        userId: participant1._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 18000,
        code: "function solve() {}",
        language: "javascript",
        status: SUBMISSION_STATUS.QUEUED,
      });

      await assert.rejects(
        async () => {
          await ContestService.finalizeContest({
            contestId: contest._id,
            actorUserId: adminUser._id,
            force: true,
            reason: "",
          });
        },
        /non-empty reason/i,
      );

      await assert.rejects(
        async () => {
          await ContestService.finalizeContest({
            contestId: contest._id,
            actorUserId: adminUser._id,
            force: true,
            reason: "   ",
          });
        },
        /non-empty reason/i,
      );
    });

    // 7. Force-finalization records an audit entry.
    await testCase("7. Force-finalization records an audit entry", async () => {
      const contest = await setupEndedContest({ slug: "force-audit-contest", participants: [participant1] });
      const pendingSub = await Submission.create({
        userId: participant1._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 20000,
        code: "function solve() {}",
        language: "javascript",
        status: SUBMISSION_STATUS.QUEUED,
      });

      const result = await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
        force: true,
        reason: "Worker queue timeout: manual emergency close",
      });

      assert.strictEqual(result.contest.status, "FINALIZED");
      assert.ok(result.audit, "audit should be returned");
      assert.strictEqual(result.audit.forced, true);
      assert.strictEqual(result.audit.pendingSubmissionCount, 1);
      assert.strictEqual(String(result.audit.pendingSubmissionIds[0]), String(pendingSub._id));
      assert.strictEqual(result.audit.reason, "Worker queue timeout: manual emergency close");
      assert.strictEqual(String(result.audit.actorUserId), String(adminUser._id));

      const auditInDb = await ContestFinalizationAudit.findOne({ contestId: contest._id });
      assert.ok(auditInDb, "audit must exist in DB");
      assert.strictEqual(auditInDb.forced, true);
      assert.strictEqual(auditInDb.pendingSubmissionCount, 1);
    });

    // 8. Queued/running submissions at force time are excluded from standings.
    await testCase("8. Queued/running submissions at force time are excluded from standings", async () => {
      const contest = await setupEndedContest({ slug: "force-excluded-standings", participants: [participant1, participant2] });

      // Participant 1 has completed Accepted submission
      const sub1 = await Submission.create({
        userId: participant1._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 60000,
        code: "function solve() {}",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      await ScoringService.applySubmissionResult(sub1._id);

      // Participant 2 has a running submission
      await Submission.create({
        userId: participant2._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 70000,
        code: "function solve() {}",
        language: "javascript",
        status: SUBMISSION_STATUS.RUNNING,
      });

      const result = await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
        force: true,
        reason: "force finalize excluding participant 2 running submission",
      });

      assert.strictEqual(result.snapshot.standings.length, 2);
      const p1Standing = result.snapshot.standings.find((s) => String(s.userId) === String(participant1._id));
      const p2Standing = result.snapshot.standings.find((s) => String(s.userId) === String(participant2._id));

      assert.strictEqual(p1Standing.rank, 1);
      assert.strictEqual(p1Standing.solvedCount, 1);
      assert.strictEqual(p2Standing.rank, 2);
      assert.strictEqual(p2Standing.solvedCount, 0);
    });

    // 9. A force-excluded submission that later receives a judge result cannot modify the finalized standings.
    await testCase("9. A force-excluded submission that later receives a judge result cannot modify the finalized standings", async () => {
      const contest = await setupEndedContest({ slug: "force-excluded-late-judge", participants: [participant1, participant2] });

      const pendingSub = await Submission.create({
        userId: participant2._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 50000,
        code: "function solve() {}",
        language: "javascript",
        status: SUBMISSION_STATUS.RUNNING,
      });

      await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
        force: true,
        reason: "force finalize before judging completes",
      });

      // Now submission finishes judging in worker path
      const updatedSub = await updateSubmission(pendingSub._id, {
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
        passed: 10,
        total: 10,
      });
      assert.strictEqual(updatedSub.status, SUBMISSION_STATUS.COMPLETED);
      assert.strictEqual(updatedSub.verdict, JUDGE_VERDICTS.ACCEPTED);

      // Scoring service called directly or via updateSubmission
      const applyResult = await ScoringService.applySubmissionResult(pendingSub._id);
      assert.strictEqual(applyResult.processed, false);

      // Verify participant 2 score in aggregate is NOT modified
      const p2Participant = await ContestParticipant.findOne({ contestId: contest._id, userId: participant2._id });
      assert.strictEqual(p2Participant.solvedCount, 0);

      // Verify snapshot standings are unchanged
      const snapshot = await ContestLeaderboardSnapshot.findOne({ contestId: contest._id, isFinal: true });
      const p2Standing = snapshot.standings.find((s) => String(s.userId) === String(participant2._id));
      assert.strictEqual(p2Standing.solvedCount, 0);
    });

    // 10. Final scoring reconciliation occurs before snapshot creation.
    await testCase("10. Final scoring reconciliation occurs before snapshot creation", async () => {
      const contest = await setupEndedContest({ slug: "reconcile-before-snapshot", participants: [participant1] });

      // Create completed Accepted submission, but simulate drift: participant aggregate is not updated
      await Submission.create({
        userId: participant1._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 120000, // 2 minutes
        code: "function solve() {}",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      // In DB, participant aggregate is currently 0 solves
      const beforeP1 = await ContestParticipant.findOne({ contestId: contest._id, userId: participant1._id });
      assert.strictEqual(beforeP1.solvedCount, 0);

      // Finalize contest without manual scoring
      const result = await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
      });

      // Snapshot must have reconciled values!
      const p1Standing = result.snapshot.standings.find((s) => String(s.userId) === String(participant1._id));
      assert.strictEqual(p1Standing.solvedCount, 1);
      assert.strictEqual(p1Standing.penalty, 2); // 120000ms / 60000 = 2 min
    });

    // 11. Finalization refuses to proceed if final reconciliation is not converged/safe.
    await testCase("11. Finalization refuses to proceed if final reconciliation is not converged/safe", async () => {
      const contest = await setupEndedContest({ slug: "unconverged-reconcile-contest" });

      const originalReconcile = ScoringService.reconcileContestScoring;
      try {
        const scoringReconcileModule = require("./services/scoring-reconcile.service");
        const origModuleFn = scoringReconcileModule.reconcileContestScoring;
        scoringReconcileModule.reconcileContestScoring = async () => ({
          completed: false,
          converged: false,
          unstable: true,
          partialFailure: true,
        });

        await assert.rejects(
          async () => {
            await ContestService.finalizeContest({
              contestId: contest._id,
              actorUserId: adminUser._id,
            });
          },
          /reconciliation did not converge/i,
        );

        const dbContest = await Contest.findById(contest._id);
        assert.strictEqual(dbContest.status, "ENDED");
        const snapshots = await ContestLeaderboardSnapshot.find({ contestId: contest._id, isFinal: true });
        assert.strictEqual(snapshots.length, 0);

        scoringReconcileModule.reconcileContestScoring = origModuleFn;
      } finally {
        ScoringService.reconcileContestScoring = originalReconcile;
      }
    });

    // 12. Final snapshot contains deterministic ICPC ordering.
    await testCase("12. Final snapshot contains deterministic ICPC ordering", async () => {
      const userA = await User.create({ firstName: "User", lastName: "A", email: "a@icpc.com", password: "p" });
      const userB = await User.create({ firstName: "User", lastName: "B", email: "b@icpc.com", password: "p" });
      const userC = await User.create({ firstName: "User", lastName: "C", email: "c@icpc.com", password: "p" });
      const userD = await User.create({ firstName: "User", lastName: "D", email: "d@icpc.com", password: "p" });

      const contest = await setupEndedContest({
        slug: "icpc-ordering-contest",
        participants: [userA, userB, userC, userD],
      });

      // userA: 2 solved, penalty 50, lastAccepted: 30000
      // userB: 2 solved, penalty 50, lastAccepted: 40000
      // userC: 2 solved, penalty 70, lastAccepted: 20000
      // userD: 1 solved, penalty 10, lastAccepted: 10000
      // Expected order: userA (rank 1), userB (rank 2), userC (rank 3), userD (rank 4)

      // userA solves problem 1 (at 10s) and problem 2 (at 30s)
      await Submission.create({
        userId: userA._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 10000,
        code: "c",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      await Submission.create({
        userId: userA._id,
        questionId: questionB._id,
        contestId: contest._id,
        contestProblemId: contest.problems[1]._id,
        submittedAtContestMs: 30000,
        code: "c",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      // userB solves problem 1 (at 10s) and problem 2 (at 40s)
      await Submission.create({
        userId: userB._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 10000,
        code: "c",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      await Submission.create({
        userId: userB._id,
        questionId: questionB._id,
        contestId: contest._id,
        contestProblemId: contest.problems[1]._id,
        submittedAtContestMs: 40000,
        code: "c",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      // userC solves problem 1 with 4 wrong attempts first, then AC at 20s (penalty = 0 + 4*5 = 20)
      // and problem 2 with 5 wrong attempts, AC at 20s (penalty = 0 + 5*10 = 50) -> total penalty = 70
      await Submission.create({
        userId: userC._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 5000,
        code: "c",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.WRONG_ANSWER,
      });
      await Submission.create({
        userId: userC._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 20000,
        code: "c",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      await Submission.create({
        userId: userC._id,
        questionId: questionB._id,
        contestId: contest._id,
        contestProblemId: contest.problems[1]._id,
        submittedAtContestMs: 20000,
        code: "c",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      // userD solves problem 1 only at 10s
      await Submission.create({
        userId: userD._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 10000,
        code: "c",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      const result = await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
      });

      const standings = result.snapshot.standings;
      assert.strictEqual(standings.length, 4);
      assert.strictEqual(standings[0].solvedCount >= standings[1].solvedCount, true);
      assert.strictEqual(String(standings[0].userId), String(userA._id));
      assert.strictEqual(String(standings[1].userId), String(userB._id));
      assert.strictEqual(String(standings[2].userId), String(userC._id));
      assert.strictEqual(String(standings[3].userId), String(userD._id));
    });

    // 13. Competition ranks are correct.
    await testCase("13. Competition ranks are correct (1, 2, 2, 4 style)", async () => {
      const contest = await setupEndedContest({ slug: "comp-rank-contest" });
      const sameUserId = new mongoose.Types.ObjectId("111111111111111111111111");
      const userOther = new mongoose.Types.ObjectId("222222222222222222222222");

      const { assignCompetitionRanks } = require("@koder/shared");
      const testEntries = [
        { userId: sameUserId, solvedCount: 2, totalPenalty: 100, lastAcceptedContestMs: 5000 },
        { userId: sameUserId, solvedCount: 2, totalPenalty: 100, lastAcceptedContestMs: 5000 },
        { userId: userOther, solvedCount: 1, totalPenalty: 50, lastAcceptedContestMs: 1000 },
      ];

      const ranked = assignCompetitionRanks(testEntries);
      assert.deepStrictEqual(
        ranked.map((e) => e.rank),
        [1, 1, 3],
      );
    });

    // 14. Final snapshot is immutable.
    await testCase("14. Final snapshot is immutable", async () => {
      const contest = await setupEndedContest({ slug: "immutable-snapshot-contest" });
      const result = await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
      });

      const snapshotDoc = await ContestLeaderboardSnapshot.findById(result.snapshot._id);
      assert.ok(snapshotDoc.isFinal);

      // Modifying and saving document should throw
      snapshotDoc.standings.push({
        userId: adminUser._id,
        rank: 99,
        solvedCount: 99,
        score: 99,
        penalty: 99,
      });
      await assert.rejects(async () => {
        await snapshotDoc.save();
      }, /immutable/i);

      // updateOne should throw
      await assert.rejects(async () => {
        await ContestLeaderboardSnapshot.updateOne({ _id: snapshotDoc._id }, { $set: { "standings.0.score": 999 } });
      }, /immutable/i);

      // deleteOne should throw
      await assert.rejects(async () => {
        await ContestLeaderboardSnapshot.deleteOne({ _id: snapshotDoc._id });
      }, /immutable/i);

      // findOneAndDelete should throw
      await assert.rejects(async () => {
        await ContestLeaderboardSnapshot.findOneAndDelete({ _id: snapshotDoc._id });
      }, /immutable/i);
    });

    // 15. Contest becomes FINALIZED exactly once.
    await testCase("15. Contest becomes FINALIZED exactly once", async () => {
      const contest = await setupEndedContest({ slug: "once-finalized-contest" });
      const result = await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
      });
      assert.strictEqual(result.contest.status, "FINALIZED");

      const snapshots = await ContestLeaderboardSnapshot.find({ contestId: contest._id, isFinal: true });
      assert.strictEqual(snapshots.length, 1);
    });

    // 16. New submissions are rejected after FINALIZED.
    await testCase("16. New submissions are rejected after FINALIZED", async () => {
      const contest = await setupEndedContest({ slug: "reject-new-sub-contest", participants: [participant1] });
      await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
      });

      await assert.rejects(
        async () => {
          await ContestService.createContestSubmission({
            contestId: contest._id,
            userId: participant1._id,
            payload: {
              contestProblemId: contest.problems[0]._id,
              code: "function solve() {}",
              language: "javascript",
            },
          });
        },
        /not currently running/i,
      );
    });

    // 17. Lifecycle mutation after FINALIZED is rejected.
    await testCase("17. Lifecycle mutation after FINALIZED is rejected", async () => {
      const contest = await setupEndedContest({ slug: "reject-lifecycle-mutation" });
      await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
      });

      await assert.rejects(
        async () => {
          await ContestService.transitionContestStatus({
            contestId: contest._id,
            targetStatus: "RUNNING",
            actorUserId: adminUser._id,
          });
        },
        /Invalid contest status transition from FINALIZED/i,
      );

      await assert.rejects(
        async () => {
          await ContestService.transitionContestStatus({
            contestId: contest._id,
            targetStatus: "ENDED",
            actorUserId: adminUser._id,
          });
        },
        /Invalid contest status transition from FINALIZED/i,
      );
    });

    // 18. Repeated finalization is idempotent.
    await testCase("18. Repeated finalization is idempotent", async () => {
      const contest = await setupEndedContest({ slug: "idempotent-contest" });
      const first = await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
      });
      assert.strictEqual(first.contest.status, "FINALIZED");

      const second = await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
      });
      assert.strictEqual(second.contest.status, "FINALIZED");
      assert.strictEqual(String(first.snapshot._id), String(second.snapshot._id));

      const snapshots = await ContestLeaderboardSnapshot.find({ contestId: contest._id, isFinal: true });
      assert.strictEqual(snapshots.length, 1);
    });

    // 19. Concurrent finalization attempts produce one authoritative snapshot.
    await testCase("19. Concurrent finalization attempts produce one authoritative snapshot", async () => {
      const contest = await setupEndedContest({ slug: "concurrent-finalize-contest" });

      const [r1, r2, r3] = await Promise.all([
        ContestService.finalizeContest({ contestId: contest._id, actorUserId: adminUser._id }),
        ContestService.finalizeContest({ contestId: contest._id, actorUserId: adminUser._id }),
        ContestService.finalizeContest({ contestId: contest._id, actorUserId: adminUser._id }),
      ]);

      assert.strictEqual(r1.contest.status, "FINALIZED");
      assert.strictEqual(r2.contest.status, "FINALIZED");
      assert.strictEqual(r3.contest.status, "FINALIZED");

      assert.strictEqual(String(r1.snapshot._id), String(r2.snapshot._id));
      assert.strictEqual(String(r2.snapshot._id), String(r3.snapshot._id));

      const snapshots = await ContestLeaderboardSnapshot.find({ contestId: contest._id, isFinal: true });
      assert.strictEqual(snapshots.length, 1);
    });

    // 20. A scoring result racing with finalization cannot modify the finalized standings.
    await testCase("20. A scoring result racing with finalization cannot modify the finalized standings", async () => {
      const contest = await setupEndedContest({ slug: "race-finalize-contest", participants: [participant1] });

      const sub = await Submission.create({
        userId: participant1._id,
        questionId: questionA._id,
        contestId: contest._id,
        contestProblemId: contest.problems[0]._id,
        submittedAtContestMs: 30000,
        code: "function solve() {}",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      // Finalize the contest
      await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
      });

      // Now worker tries to apply scoring for a submission after finalization
      const scoringResult = await ScoringService.applySubmissionResult(sub._id);
      assert.strictEqual(scoringResult.processed, false);
      assert.strictEqual(scoringResult.reason, "contest_finalized");

      // Verify snapshot was not mutated
      const snapshot = await ContestLeaderboardSnapshot.findOne({ contestId: contest._id, isFinal: true });
      assert.strictEqual(snapshot.isFinal, true);
    });

    // 21. Failure before snapshot creation can be retried safely.
    await testCase("21. Failure before snapshot creation can be retried safely", async () => {
      const contest = await setupEndedContest({ slug: "retry-safe-contest" });

      const scoringReconcileModule = require("./services/scoring-reconcile.service");
      const origModuleFn = scoringReconcileModule.reconcileContestScoring;

      // Fail once
      scoringReconcileModule.reconcileContestScoring = async () => {
        throw new Error("Temporary DB connection drop during reconciliation");
      };

      await assert.rejects(
        async () => {
          await ContestService.finalizeContest({
            contestId: contest._id,
            actorUserId: adminUser._id,
          });
        },
        /Temporary DB connection drop/i,
      );

      // Verify contest is still ENDED
      let dbContest = await Contest.findById(contest._id);
      assert.strictEqual(dbContest.status, "ENDED");

      // Restore module function
      scoringReconcileModule.reconcileContestScoring = origModuleFn;

      // Retry finalization
      const retried = await ContestService.finalizeContest({
        contestId: contest._id,
        actorUserId: adminUser._id,
      });

      assert.strictEqual(retried.contest.status, "FINALIZED");
      assert.ok(retried.snapshot);

      dbContest = await Contest.findById(contest._id);
      assert.strictEqual(dbContest.status, "FINALIZED");
    });

    // 22. Failure during snapshot persistence does not leave the contest falsely finalized.
    await testCase("22. Failure during snapshot persistence does not leave the contest falsely finalized", async () => {
      const contest = await setupEndedContest({ slug: "snapshot-fail-contest" });

      const origCreate = ContestLeaderboardSnapshot.create;
      ContestLeaderboardSnapshot.create = async () => {
        throw new Error("Simulated snapshot write error");
      };

      try {
        await assert.rejects(
          async () => {
            await ContestService.finalizeContest({
              contestId: contest._id,
              actorUserId: adminUser._id,
            });
          },
          /Simulated snapshot write error/i,
        );

        // Contest must NOT be falsely finalized
        const dbContest = await Contest.findById(contest._id);
        assert.strictEqual(dbContest.status, "ENDED");
      } finally {
        ContestLeaderboardSnapshot.create = origCreate;
      }
    });

    console.log(`\n=======================================================`);
    console.log(`ISSUE-607 finalization test summary: ${passed} passed, ${failed} failed`);
    console.log(`=======================================================\n`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

runTests().catch((error) => {
  console.error("Test runner error:", error);
  process.exitCode = 1;
});
