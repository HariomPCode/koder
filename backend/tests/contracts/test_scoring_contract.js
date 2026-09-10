const assert = require("assert");
const mongoose = require("mongoose");
const {
  JUDGE_VERDICTS,
  SUBMISSION_STATUS,
  WRONG_ATTEMPT_VERDICTS,
  SOLVING_VERDICT,
  SCORING_EFFECT,
  isTerminalForScoring,
  isWrongAttemptVerdict,
  isSolvingVerdict,
  msToSolveMinutes,
  calculateProblemPenalty,
  compareCanonicalSubmissionOrder,
  pickCanonicalAcceptedSubmission,
  countWrongAttemptsBeforeSolve,
  compareParticipantStandings,
  assignCompetitionRanks,
} = require("@koder/shared");

function submission(id, submittedAtContestMs, verdict, status = SUBMISSION_STATUS.COMPLETED) {
  return {
    _id: id,
    submittedAtContestMs,
    verdict,
    status,
  };
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
      console.log(`    ${error.message}`);
      failed += 1;
    }
  }

  await testCase("wrong-attempt verdict classification matches finalized contract", async () => {
    assert.strictEqual(isWrongAttemptVerdict(JUDGE_VERDICTS.WRONG_ANSWER), true);
    assert.strictEqual(isWrongAttemptVerdict(JUDGE_VERDICTS.COMPILATION_ERROR), true);
    assert.strictEqual(isWrongAttemptVerdict(JUDGE_VERDICTS.RUNTIME_ERROR), true);
    assert.strictEqual(isWrongAttemptVerdict(JUDGE_VERDICTS.TIME_LIMIT_EXCEEDED), true);
    assert.strictEqual(isWrongAttemptVerdict(JUDGE_VERDICTS.MEMORY_LIMIT_EXCEEDED), true);
    assert.strictEqual(isWrongAttemptVerdict(JUDGE_VERDICTS.ACCEPTED), false);
    assert.strictEqual(WRONG_ATTEMPT_VERDICTS.size, 5);
  });

  await testCase("solving verdict is Accepted only", async () => {
    assert.strictEqual(SOLVING_VERDICT, JUDGE_VERDICTS.ACCEPTED);
    assert.strictEqual(isSolvingVerdict(JUDGE_VERDICTS.ACCEPTED), true);
    assert.strictEqual(isSolvingVerdict(JUDGE_VERDICTS.WRONG_ANSWER), false);
  });

  await testCase("only completed submissions are terminal for scoring", async () => {
    assert.strictEqual(isTerminalForScoring(SUBMISSION_STATUS.COMPLETED), true);
    assert.strictEqual(isTerminalForScoring(SUBMISSION_STATUS.CREATED), false);
    assert.strictEqual(isTerminalForScoring(SUBMISSION_STATUS.QUEUED), false);
    assert.strictEqual(isTerminalForScoring(SUBMISSION_STATUS.RUNNING), false);
    assert.strictEqual(isTerminalForScoring(SUBMISSION_STATUS.PENDING), false);
  });

  await testCase("ICPC problem penalty formula uses solve minutes and wrong attempts", async () => {
    assert.strictEqual(msToSolveMinutes(2220000), 37);
    assert.strictEqual(
      calculateProblemPenalty({
        firstAcceptedAtContestMs: 2220000,
        wrongAttempts: 0,
        penaltyMinutes: 5,
      }),
      37,
    );
    assert.strictEqual(
      calculateProblemPenalty({
        firstAcceptedAtContestMs: 2400000,
        wrongAttempts: 2,
        penaltyMinutes: 5,
      }),
      50,
    );
  });

  await testCase("canonical Accepted ordering uses submittedAtContestMs then submissionId", async () => {
    const idA = new mongoose.Types.ObjectId("000000000000000000000001");
    const idB = new mongoose.Types.ObjectId("000000000000000000000002");
    const idC = new mongoose.Types.ObjectId("000000000000000000000003");

    const earlierByTime = submission(idA, 1000, JUDGE_VERDICTS.ACCEPTED);
    const laterByTime = submission(idB, 2000, JUDGE_VERDICTS.ACCEPTED);
    assert.ok(compareCanonicalSubmissionOrder(earlierByTime, laterByTime) < 0);

    const sameTimeLowerId = submission(idA, 1500, JUDGE_VERDICTS.ACCEPTED);
    const sameTimeHigherId = submission(idC, 1500, JUDGE_VERDICTS.ACCEPTED);
    assert.ok(compareCanonicalSubmissionOrder(sameTimeLowerId, sameTimeHigherId) < 0);
  });

  await testCase("pickCanonicalAcceptedSubmission ignores non-terminal and non-Accepted submissions", async () => {
    const idA = new mongoose.Types.ObjectId();
    const idB = new mongoose.Types.ObjectId();
    const idC = new mongoose.Types.ObjectId();
    const idD = new mongoose.Types.ObjectId();

    const submissions = [
      submission(idA, 1000, JUDGE_VERDICTS.WRONG_ANSWER),
      submission(idB, 2000, JUDGE_VERDICTS.WRONG_ANSWER),
      submission(idC, 3000, JUDGE_VERDICTS.ACCEPTED),
      submission(idD, 1500, JUDGE_VERDICTS.ACCEPTED),
      submission(new mongoose.Types.ObjectId(), 500, JUDGE_VERDICTS.ACCEPTED, SUBMISSION_STATUS.QUEUED),
    ];

    const canonical = pickCanonicalAcceptedSubmission(submissions);
    assert.strictEqual(String(canonical._id), String(idD));
  });

  await testCase("wrong attempts count only terminal wrong verdicts before canonical solve time", async () => {
    const solveMs = 3000;
    const submissions = [
      submission(new mongoose.Types.ObjectId(), 1000, JUDGE_VERDICTS.WRONG_ANSWER),
      submission(new mongoose.Types.ObjectId(), 2000, JUDGE_VERDICTS.COMPILATION_ERROR),
      submission(new mongoose.Types.ObjectId(), 2500, JUDGE_VERDICTS.ACCEPTED),
      submission(new mongoose.Types.ObjectId(), 3500, JUDGE_VERDICTS.WRONG_ANSWER),
      submission(new mongoose.Types.ObjectId(), 900, JUDGE_VERDICTS.WRONG_ANSWER, SUBMISSION_STATUS.QUEUED),
    ];

    assert.strictEqual(countWrongAttemptsBeforeSolve(submissions, solveMs), 2);
  });

  await testCase("standings tie-break and competition ranking follow finalized policy", async () => {
    const userA = new mongoose.Types.ObjectId("000000000000000000000011");
    const userB = new mongoose.Types.ObjectId("000000000000000000000012");
    const userC = new mongoose.Types.ObjectId("000000000000000000000013");

    const participants = [
      { userId: userA, solvedCount: 2, totalPenalty: 100, lastAcceptedContestMs: 5000 },
      { userId: userB, solvedCount: 3, totalPenalty: 200, lastAcceptedContestMs: 8000 },
      { userId: userC, solvedCount: 2, totalPenalty: 100, lastAcceptedContestMs: 5000 },
    ];

    assert.ok(compareParticipantStandings(participants[1], participants[0]) < 0);
    assert.ok(compareParticipantStandings(participants[0], participants[2]) < 0);

    const ranked = assignCompetitionRanks(participants);
    assert.deepStrictEqual(
      ranked.map((entry) => entry.rank),
      [1, 2, 3],
    );
  });

  await testCase("competition ranking shares rank only when all tie-break keys match", async () => {
    const userA = new mongoose.Types.ObjectId("000000000000000000000011");
    const tiedEntry = {
      userId: userA,
      solvedCount: 2,
      totalPenalty: 100,
      lastAcceptedContestMs: 5000,
    };

    const ranked = assignCompetitionRanks([tiedEntry, { ...tiedEntry }, { userId: userA, solvedCount: 1, totalPenalty: 50, lastAcceptedContestMs: 1000 }]);
    assert.deepStrictEqual(
      ranked.map((entry) => entry.rank),
      [1, 1, 3],
    );
  });

  await testCase("scoring effect enum is stable for future ledger integration", async () => {
    assert.strictEqual(SCORING_EFFECT.SOLVE, "solve");
    assert.strictEqual(SCORING_EFFECT.IGNORED_POST_SOLVE, "ignored-post-solve");
    assert.strictEqual(SCORING_EFFECT.IGNORED_NONCANONICAL_AC, "ignored-noncanonical-ac");
  });

  console.log(`\nScoring contract checks: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
