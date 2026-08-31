const assert = require("assert");
const mongoose = require("mongoose");

const ContestParticipant = require("./models/ContestParticipant");
const ContestParticipantProblem = require("./models/ContestParticipantProblem");
const ContestScoredSubmission = require("./models/ContestScoredSubmission");
const Submission = require("./models/Submission");
const { JUDGE_VERDICTS, SUBMISSION_STATUS, SCORING_EFFECT } = require("@koder/shared");

const DEFAULT_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/koder_phase6_scoring_test";

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
    ContestParticipant.syncIndexes(),
    ContestParticipantProblem.syncIndexes(),
    ContestScoredSubmission.syncIndexes(),
    Submission.syncIndexes(),
  ]);
}

async function runTests() {
  try {
    await resetDb();

    const contestId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const contestProblemId = new mongoose.Types.ObjectId();
    const submissionId = new mongoose.Types.ObjectId();
    const laterSubmissionId = new mongoose.Types.ObjectId();

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

    await testCase("ContestParticipant aggregate scoring fields default to zero/null", async () => {
      const participant = new ContestParticipant({
        contestId,
        userId,
        registeredAt: new Date(),
      });

      await participant.validate();
      assert.strictEqual(participant.solvedCount, 0);
      assert.strictEqual(participant.totalPenalty, 0);
      assert.strictEqual(participant.lastAcceptedContestMs, null);
    });

    await testCase("ContestParticipant standings index exists for contest ranking reads", async () => {
      const indexes = await ContestParticipant.collection.getIndexes();
      assert.ok(
        hasIndex(indexes, {
          contestId: 1,
          solvedCount: -1,
          totalPenalty: 1,
          lastAcceptedContestMs: 1,
          userId: 1,
        }),
        "contest standings index missing",
      );
    });

    await testCase("ContestParticipantProblem stores solved-state fields and validates solved invariants", async () => {
      const unsolved = new ContestParticipantProblem({
        contestId,
        userId,
        contestProblemId,
      });
      await unsolved.validate();
      assert.strictEqual(unsolved.solved, false);
      assert.strictEqual(unsolved.problemPenalty, 0);

      const solved = new ContestParticipantProblem({
        contestId,
        userId,
        contestProblemId: new mongoose.Types.ObjectId(),
        solved: true,
        firstAcceptedSubmissionId: submissionId,
        firstAcceptedAtContestMs: 2400000,
        problemPenalty: 50,
      });
      await solved.validate();
      assert.strictEqual(solved.firstAcceptedAtContestMs, 2400000);
      assert.strictEqual(solved.problemPenalty, 50);

      const invalidSolved = new ContestParticipantProblem({
        contestId,
        userId,
        contestProblemId: new mongoose.Types.ObjectId(),
        solved: true,
      });
      await assert.rejects(() => invalidSolved.validate(), /firstAcceptedSubmissionId|firstAcceptedAtContestMs/i);
    });

    await testCase("ContestParticipantProblem unique participant/problem index blocks duplicates", async () => {
      await ContestParticipantProblem.create({
        contestId,
        userId,
        contestProblemId,
      });

      await assert.rejects(
        () =>
          ContestParticipantProblem.create({
            contestId,
            userId,
            contestProblemId,
          }),
        /duplicate|E11000/i,
      );

      const indexes = await ContestParticipantProblem.collection.getIndexes();
      assert.ok(
        hasIndex(indexes, { contestId: 1, userId: 1, contestProblemId: 1 }),
        "contest participant problem unique index missing",
      );
    });

    await testCase("ContestScoredSubmission ledger enforces unique submissionId", async () => {
      await ContestScoredSubmission.create({
        submissionId,
        contestId,
        userId,
        contestProblemId,
        verdict: JUDGE_VERDICTS.WRONG_ANSWER,
        submittedAtContestMs: 120000,
        effect: SCORING_EFFECT.WRONG,
      });

      await assert.rejects(
        () =>
          ContestScoredSubmission.create({
            submissionId,
            contestId,
            userId,
            contestProblemId,
            verdict: JUDGE_VERDICTS.ACCEPTED,
            submittedAtContestMs: 180000,
            effect: SCORING_EFFECT.SOLVE,
          }),
        /duplicate|E11000/i,
      );

      const indexes = await ContestScoredSubmission.collection.getIndexes();
      assert.ok(hasIndex(indexes, { submissionId: 1 }), "submissionId unique index missing");
    });

    await testCase("Submission scoring query index exists for canonical solve lookup", async () => {
      const indexes = await Submission.collection.getIndexes();
      assert.ok(
        hasIndex(indexes, {
          contestId: 1,
          userId: 1,
          contestProblemId: 1,
          submittedAtContestMs: 1,
        }),
        "contest submission timing index missing",
      );
    });

    await testCase("schema supports WA WA AC AC canonical first-AC representation without scoring processor", async () => {
      const solvedProblemId = new mongoose.Types.ObjectId();
      const firstAcceptedSubmissionId = new mongoose.Types.ObjectId();
      const problemState = await ContestParticipantProblem.create({
        contestId,
        userId,
        contestProblemId: solvedProblemId,
        solved: true,
        firstAcceptedSubmissionId,
        firstAcceptedAtContestMs: 2400000,
        problemPenalty: 50,
      });

      assert.strictEqual(problemState.solved, true);
      assert.strictEqual(String(problemState.firstAcceptedSubmissionId), String(firstAcceptedSubmissionId));
      assert.notStrictEqual(String(problemState.firstAcceptedSubmissionId), String(laterSubmissionId));

      await ContestScoredSubmission.create({
        submissionId: firstAcceptedSubmissionId,
        contestId,
        userId,
        contestProblemId: solvedProblemId,
        verdict: JUDGE_VERDICTS.ACCEPTED,
        submittedAtContestMs: 2400000,
        effect: SCORING_EFFECT.SOLVE,
      });

      await ContestScoredSubmission.create({
        submissionId: laterSubmissionId,
        contestId,
        userId,
        contestProblemId: solvedProblemId,
        verdict: JUDGE_VERDICTS.ACCEPTED,
        submittedAtContestMs: 3000000,
        effect: SCORING_EFFECT.IGNORED_NONCANONICAL_AC,
      });

      const ledgerCount = await ContestScoredSubmission.countDocuments({
        contestId,
        userId,
        contestProblemId: solvedProblemId,
      });
      assert.strictEqual(ledgerCount, 2);
      assert.strictEqual(problemState.problemPenalty, 50);
    });

    await testCase("practice submissions remain unaffected by scoring models", async () => {
      const practiceSubmission = new Submission({
        userId,
        questionId: new mongoose.Types.ObjectId(),
        code: "console.log('practice')",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
        contestId: null,
        contestProblemId: null,
        submittedAtContestMs: null,
      });

      await practiceSubmission.validate();
      assert.strictEqual(practiceSubmission.contestId, null);
    });

    console.log(`\nScoring model checks: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      throw new Error(`${failed} scoring model checks failed`);
    }
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
