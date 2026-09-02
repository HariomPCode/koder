const assert = require("assert");
const mongoose = require("mongoose");

const User = require("./models/User");
const Question = require("./models/Question");
const Contest = require("./models/Contest");
const ContestParticipant = require("./models/ContestParticipant");
const ContestParticipantProblem = require("./models/ContestParticipantProblem");
const ContestScoredSubmission = require("./models/ContestScoredSubmission");
const Submission = require("./models/Submission");
const {
  JUDGE_VERDICTS,
  SUBMISSION_STATUS,
  applySubmissionResult,
  pickCanonicalAcceptedSubmission,
  countWrongAttemptsBeforeSolve,
  calculateProblemPenalty,
  compareCanonicalSubmissionOrder,
} = require("@koder/shared");

const DEFAULT_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/koder_phase6_scoring_ordering_test";

const MS_PER_MINUTE = 60 * 1000;
const PENALTY_MINUTES = 5;

const SIX_PERMUTATIONS = [
  ["A", "B", "C"],
  ["A", "C", "B"],
  ["B", "A", "C"],
  ["B", "C", "A"],
  ["C", "A", "B"],
  ["C", "B", "A"],
];

function minutes(value) {
  return value * MS_PER_MINUTE;
}

let userCounter = 0;

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
    Submission.syncIndexes(),
  ]);
}

async function createBaseQuestion(slugSuffix) {
  return Question.create({
    questionNum: 700 + userCounter,
    title: `Ordering Problem ${slugSuffix}`,
    slug: `ordering-problem-${slugSuffix}`,
    difficulty: "Easy",
    description: "ISSUE-605 ordering test problem",
    starterCode: [{ language: "javascript", code: "function solve() {}" }],
    functionName: "solve",
    parameters: [{ name: "input", type: "string" }],
    returnType: "string",
    constraints: ["1 <= n <= 10^5"],
    tags: ["scoring", "ordering"],
  });
}

async function createAdminUser() {
  userCounter += 1;
  return User.create({
    firstName: "Ordering",
    lastName: "Admin",
    email: `ordering.admin.${userCounter}@example.com`,
    password: "hashed-password",
    role: "admin",
  });
}

async function createParticipantUser(label) {
  userCounter += 1;
  return User.create({
    firstName: "Ordering",
    lastName: label,
    email: `ordering.${label}.${userCounter}@example.com`,
    password: "hashed-password",
  });
}

async function createContestContext({ adminUser, participantUser, question, problemCount = 1 }) {
  const now = Date.now();
  const problems = Array.from({ length: problemCount }, (_, index) => ({
    questionId: question._id,
    order: index + 1,
    points: 100,
    penaltyMinutes: PENALTY_MINUTES,
  }));

  userCounter += 1;
  const contest = await Contest.create({
    title: `Ordering Contest ${userCounter}`,
    slug: `ordering-contest-${userCounter}`,
    description: "ISSUE-605 ordering and concurrency tests",
    registrationOpenTime: new Date(now - 3 * 60 * 60 * 1000),
    startTime: new Date(now - 2 * 60 * 60 * 1000),
    endTime: new Date(now + 2 * 60 * 60 * 1000),
    status: "RUNNING",
    createdBy: adminUser._id,
    problems,
  });

  await ContestParticipant.create({
    contestId: contest._id,
    userId: participantUser._id,
    registeredAt: new Date(),
  });

  return {
    contest,
    userId: participantUser._id,
    problemIds: contest.problems.map((problem) => problem._id),
  };
}

async function createCompletedSubmission({
  userId,
  questionId,
  contestId,
  contestProblemId,
  submittedAtContestMs,
  verdict,
  submissionId = null,
}) {
  const payload = {
    userId,
    questionId,
    contestId,
    contestProblemId,
    submittedAtContestMs,
    code: "console.log('ordering-test')",
    language: "javascript",
    status: SUBMISSION_STATUS.COMPLETED,
    verdict,
    passedTestCases: verdict === JUDGE_VERDICTS.ACCEPTED ? 1 : 0,
    totalTestCases: 1,
  };

  if (submissionId) {
    payload._id = submissionId;
  }

  return Submission.create(payload);
}

function toScoringSubmission(submission) {
  return {
    _id: submission._id,
    status: submission.status,
    verdict: submission.verdict,
    submittedAtContestMs: submission.submittedAtContestMs,
  };
}

function expectedSingleProblemState(submissions, penaltyMinutes = PENALTY_MINUTES) {
  const scoringSubmissions = submissions.map(toScoringSubmission);
  const canonical = pickCanonicalAcceptedSubmission(scoringSubmissions);

  if (!canonical) {
    return {
      solved: false,
      solvedCount: 0,
      totalPenalty: 0,
      lastAcceptedContestMs: null,
      canonicalId: null,
      firstAcceptedAtContestMs: null,
      problemPenalty: 0,
    };
  }

  const wrongAttempts = countWrongAttemptsBeforeSolve(
    scoringSubmissions,
    canonical.submittedAtContestMs,
  );
  const problemPenalty = calculateProblemPenalty({
    firstAcceptedAtContestMs: canonical.submittedAtContestMs,
    wrongAttempts,
    penaltyMinutes,
  });

  return {
    solved: true,
    solvedCount: 1,
    totalPenalty: problemPenalty,
    lastAcceptedContestMs: canonical.submittedAtContestMs,
    canonicalId: canonical._id,
    firstAcceptedAtContestMs: canonical.submittedAtContestMs,
    problemPenalty,
  };
}

function expectedMultiProblemState(problemResults) {
  const solved = problemResults.filter((result) => result.solved);
  const totalPenalty = solved.reduce((sum, result) => sum + result.problemPenalty, 0);
  const lastAcceptedContestMs =
    solved.length === 0
      ? null
      : solved.reduce(
          (max, result) => Math.max(max, result.firstAcceptedAtContestMs ?? 0),
          0,
        );

  return {
    solvedCount: solved.length,
    totalPenalty,
    lastAcceptedContestMs,
    problems: problemResults,
  };
}

async function getParticipantState(contestId, userId) {
  return ContestParticipant.findOne({ contestId, userId }).lean();
}

async function getProblemState(contestId, userId, contestProblemId) {
  return ContestParticipantProblem.findOne({ contestId, userId, contestProblemId }).lean();
}

async function processSequentially(submissionIds) {
  for (const submissionId of submissionIds) {
    await applySubmissionResult(submissionId);
  }
}

async function processConcurrently(submissionIds) {
  await Promise.all(submissionIds.map((submissionId) => applySubmissionResult(submissionId)));
}

async function assertSingleProblemScoringState({
  contestId,
  userId,
  contestProblemId,
  expected,
  submissionIds,
}) {
  const problemCount = await ContestParticipantProblem.countDocuments({
    contestId,
    userId,
    contestProblemId,
  });
  assert.strictEqual(problemCount, expected.solved ? 1 : 0);

  const problem = await getProblemState(contestId, userId, contestProblemId);
  const participant = await getParticipantState(contestId, userId);

  if (!expected.solved) {
    assert.ok(!problem || !problem.solved);
    assert.strictEqual(participant.solvedCount, 0);
    assert.strictEqual(participant.totalPenalty, 0);
    assert.strictEqual(participant.lastAcceptedContestMs, null);
  } else {
    assert.strictEqual(problem.solved, true);
    assert.strictEqual(String(problem.firstAcceptedSubmissionId), String(expected.canonicalId));
    assert.strictEqual(problem.firstAcceptedAtContestMs, expected.firstAcceptedAtContestMs);
    assert.strictEqual(problem.problemPenalty, expected.problemPenalty);
    assert.strictEqual(participant.solvedCount, expected.solvedCount);
    assert.strictEqual(participant.totalPenalty, expected.totalPenalty);
    assert.strictEqual(participant.lastAcceptedContestMs, expected.lastAcceptedContestMs);
  }

  if (submissionIds) {
    const ledgerCount = await ContestScoredSubmission.countDocuments({
      submissionId: { $in: submissionIds },
    });
    assert.strictEqual(ledgerCount, submissionIds.length);
  }
}

async function assertMultiProblemScoringState({
  contestId,
  userId,
  problemIds,
  expected,
  submissionIds,
}) {
  const participant = await getParticipantState(contestId, userId);
  assert.strictEqual(participant.solvedCount, expected.solvedCount);
  assert.strictEqual(participant.totalPenalty, expected.totalPenalty);
  assert.strictEqual(participant.lastAcceptedContestMs, expected.lastAcceptedContestMs);

  for (let index = 0; index < problemIds.length; index += 1) {
    const problemId = problemIds[index];
    const problemExpected = expected.problems[index];
    const problemCount = await ContestParticipantProblem.countDocuments({
      contestId,
      userId,
      contestProblemId: problemId,
    });
    assert.strictEqual(problemCount, problemExpected.solved ? 1 : 0);

    const problem = await getProblemState(contestId, userId, problemId);
    if (!problemExpected.solved) {
      assert.ok(!problem || !problem.solved);
      continue;
    }

    assert.strictEqual(problem.solved, true);
    assert.strictEqual(String(problem.firstAcceptedSubmissionId), String(problemExpected.canonicalId));
    assert.strictEqual(problem.firstAcceptedAtContestMs, problemExpected.firstAcceptedAtContestMs);
    assert.strictEqual(problem.problemPenalty, problemExpected.problemPenalty);
  }

  if (submissionIds) {
    const ledgerCount = await ContestScoredSubmission.countDocuments({
      submissionId: { $in: submissionIds },
    });
    assert.strictEqual(ledgerCount, submissionIds.length);
  }
}

function makeOrderedSubmissionIdPair() {
  userCounter += 1;
  const base = userCounter.toString(16).padStart(22, "0");
  const lowerId = new mongoose.Types.ObjectId(`${base}01`);
  const higherId = new mongoose.Types.ObjectId(`${base}02`);
  return { lowerId, higherId };
}

async function runPermutationMatrix({
  name,
  submissionsByKey,
  orders = SIX_PERMUTATIONS,
  penaltyMinutes = PENALTY_MINUTES,
}) {
  for (const order of orders) {
    userCounter += 1;
    const permSuffix = `${name}-${order.join("")}-${userCounter}`;
    const adminUser = await createAdminUser();
    const participantUser = await createParticipantUser(`perm-${permSuffix}`);
    const question = await createBaseQuestion(`perm-${permSuffix}`);
    const { contest, userId, problemIds } = await createContestContext({
      adminUser,
      participantUser,
      question,
    });
    const problemId = problemIds[0];

    const created = {};
    for (const [key, spec] of Object.entries(submissionsByKey)) {
      created[key] = await createCompletedSubmission({
        userId,
        questionId: question._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(spec.minutes),
        verdict: spec.verdict,
        submissionId: spec.submissionId || null,
      });
    }

    const submissionIds = order.map((key) => created[key]._id);
    await processSequentially(submissionIds);

    const expected = expectedSingleProblemState(Object.values(created), penaltyMinutes);
    await assertSingleProblemScoringState({
      contestId: contest._id,
      userId,
      contestProblemId: problemId,
      expected,
      submissionIds: Object.values(created).map((submission) => submission._id),
    });

    const replayIds = [...submissionIds].reverse();
    await processSequentially(replayIds);
    await assertSingleProblemScoringState({
      contestId: contest._id,
      userId,
      contestProblemId: problemId,
      expected,
      submissionIds: Object.values(created).map((submission) => submission._id),
    });
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
      console.log(`  ✗ ${name}`);
      console.log(`    ${error.message}`);
      failed += 1;
    }
  }

  try {
    await resetDb();

    await testCase("ISSUE-605 P0: AC@40 AC@35 WA@20 permutation invariance (6 orders)", async () => {
      await runPermutationMatrix({
        name: "ac-ac-wa",
        submissionsByKey: {
          A: { minutes: 40, verdict: JUDGE_VERDICTS.ACCEPTED },
          B: { minutes: 35, verdict: JUDGE_VERDICTS.ACCEPTED },
          C: { minutes: 20, verdict: JUDGE_VERDICTS.WRONG_ANSWER },
        },
      });
    });

    await testCase("ISSUE-605 P0: WA@10 AC@20 AC@30 permutation invariance (6 orders)", async () => {
      await runPermutationMatrix({
        name: "wa-ac-ac",
        submissionsByKey: {
          A: { minutes: 10, verdict: JUDGE_VERDICTS.WRONG_ANSWER },
          B: { minutes: 20, verdict: JUDGE_VERDICTS.ACCEPTED },
          C: { minutes: 30, verdict: JUDGE_VERDICTS.ACCEPTED },
        },
      });

      const adminUser = await createAdminUser();
      const participantUser = await createParticipantUser("wa-ac-ac-check");
      const question = await createBaseQuestion("wa-ac-ac-check");
      const { contest, userId, problemIds } = await createContestContext({
        adminUser,
        participantUser,
        question,
      });
      const wa = await createCompletedSubmission({
        userId,
        questionId: question._id,
        contestId: contest._id,
        contestProblemId: problemIds[0],
        submittedAtContestMs: minutes(10),
        verdict: JUDGE_VERDICTS.WRONG_ANSWER,
      });
      const ac20 = await createCompletedSubmission({
        userId,
        questionId: question._id,
        contestId: contest._id,
        contestProblemId: problemIds[0],
        submittedAtContestMs: minutes(20),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const ac30 = await createCompletedSubmission({
        userId,
        questionId: question._id,
        contestId: contest._id,
        contestProblemId: problemIds[0],
        submittedAtContestMs: minutes(30),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const expected = expectedSingleProblemState([wa, ac20, ac30]);
      assert.strictEqual(expected.problemPenalty, 25);
    });

    await testCase("ISSUE-605 P0: AC@30 WA@35 AC@20 post-solve WA permutation invariance (6 orders)", async () => {
      await runPermutationMatrix({
        name: "ac-wa-ac",
        submissionsByKey: {
          A: { minutes: 30, verdict: JUDGE_VERDICTS.ACCEPTED },
          B: { minutes: 35, verdict: JUDGE_VERDICTS.WRONG_ANSWER },
          C: { minutes: 20, verdict: JUDGE_VERDICTS.ACCEPTED },
        },
      });

      const adminUser = await createAdminUser();
      const participantUser = await createParticipantUser("ac-wa-ac-check");
      const question = await createBaseQuestion("ac-wa-ac-check");
      const { contest, userId, problemIds } = await createContestContext({
        adminUser,
        participantUser,
        question,
      });
      const subs = [
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemIds[0],
          submittedAtContestMs: minutes(30),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        }),
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemIds[0],
          submittedAtContestMs: minutes(35),
          verdict: JUDGE_VERDICTS.WRONG_ANSWER,
        }),
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemIds[0],
          submittedAtContestMs: minutes(20),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        }),
      ];
      const expected = expectedSingleProblemState(subs);
      assert.strictEqual(expected.problemPenalty, 20);
    });

    await testCase("ISSUE-605 P0: reverse out-of-order AC@40 then AC@35 matches AC@35 then AC@40", async () => {
      async function runDirection(firstMinutes, secondMinutes) {
        const adminUser = await createAdminUser();
        const participantUser = await createParticipantUser(`ooo-${firstMinutes}-${secondMinutes}`);
        const question = await createBaseQuestion(`ooo-${firstMinutes}-${secondMinutes}`);
        const { contest, userId, problemIds } = await createContestContext({
          adminUser,
          participantUser,
          question,
        });
        const problemId = problemIds[0];

        const first = await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemId,
          submittedAtContestMs: minutes(firstMinutes),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        });
        await applySubmissionResult(first._id);

        const second = await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemId,
          submittedAtContestMs: minutes(secondMinutes),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        });
        await applySubmissionResult(second._id);

        const expected = expectedSingleProblemState([first, second]);
        await assertSingleProblemScoringState({
          contestId: contest._id,
          userId,
          contestProblemId: problemId,
          expected,
          submissionIds: [first._id, second._id],
        });

        return { contestId: contest._id, userId, problemId, expected };
      }

      const forward = await runDirection(40, 35);
      const reverse = await runDirection(35, 40);

      const forwardState = {
        problemPenalty: forward.expected.problemPenalty,
        solvedCount: forward.expected.solvedCount,
        totalPenalty: forward.expected.totalPenalty,
        lastAcceptedContestMs: forward.expected.lastAcceptedContestMs,
        firstAcceptedAtContestMs: forward.expected.firstAcceptedAtContestMs,
      };
      const reverseState = {
        problemPenalty: reverse.expected.problemPenalty,
        solvedCount: reverse.expected.solvedCount,
        totalPenalty: reverse.expected.totalPenalty,
        lastAcceptedContestMs: reverse.expected.lastAcceptedContestMs,
        firstAcceptedAtContestMs: reverse.expected.firstAcceptedAtContestMs,
      };

      assert.deepStrictEqual(forwardState, reverseState);
      assert.strictEqual(forward.expected.problemPenalty, 35);
      assert.strictEqual(forward.expected.firstAcceptedAtContestMs, minutes(35));
    });

    await testCase("ISSUE-605 P0: same-ms Accepted tie-break uses lower submissionId", async () => {
      const sameMs = minutes(7);

      async function runSameMsOrder(firstId, secondId, concurrent = false) {
        userCounter += 1;
        const slugSuffix = `same-ms-${userCounter}`;
        const adminUser = await createAdminUser();
        const participantUser = await createParticipantUser(slugSuffix);
        const question = await createBaseQuestion(slugSuffix);
        const { contest, userId, problemIds } = await createContestContext({
          adminUser,
          participantUser,
          question,
        });
        const problemId = problemIds[0];

        const first = await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemId,
          submittedAtContestMs: sameMs,
          verdict: JUDGE_VERDICTS.ACCEPTED,
          submissionId: firstId,
        });
        const second = await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemId,
          submittedAtContestMs: sameMs,
          verdict: JUDGE_VERDICTS.ACCEPTED,
          submissionId: secondId,
        });

        if (concurrent) {
          await processConcurrently([first._id, second._id]);
        } else {
          await processSequentially([first._id, second._id]);
        }

        const expected = expectedSingleProblemState([first, second]);
        const expectedLowerId =
          compareCanonicalSubmissionOrder(
            { _id: first._id, submittedAtContestMs: sameMs },
            { _id: second._id, submittedAtContestMs: sameMs },
          ) < 0
            ? first._id
            : second._id;
        assert.strictEqual(String(expected.canonicalId), String(expectedLowerId));
        await assertSingleProblemScoringState({
          contestId: contest._id,
          userId,
          contestProblemId: problemId,
          expected,
          submissionIds: [first._id, second._id],
        });
      }

      const pairOne = makeOrderedSubmissionIdPair();
      await runSameMsOrder(pairOne.lowerId, pairOne.higherId, false);

      const pairTwo = makeOrderedSubmissionIdPair();
      await runSameMsOrder(pairTwo.higherId, pairTwo.lowerId, false);

      const pairThree = makeOrderedSubmissionIdPair();
      await runSameMsOrder(pairThree.lowerId, pairThree.higherId, true);
    });

    await testCase("ISSUE-605 P0: wrong-attempt boundary at 19/20/21 vs AC@20", async () => {
      async function runBoundary(waMinutes, shouldCount) {
        const adminUser = await createAdminUser();
        const participantUser = await createParticipantUser(`wa-${waMinutes}`);
        const question = await createBaseQuestion(`wa-${waMinutes}`);
        const { contest, userId, problemIds } = await createContestContext({
          adminUser,
          participantUser,
          question,
        });
        const problemId = problemIds[0];

        const wa = await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemId,
          submittedAtContestMs: minutes(waMinutes),
          verdict: JUDGE_VERDICTS.WRONG_ANSWER,
        });
        const ac = await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemId,
          submittedAtContestMs: minutes(20),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        });

        await processSequentially([wa._id, ac._id]);
        const expected = expectedSingleProblemState([wa, ac]);
        const expectedPenalty = shouldCount ? 20 + PENALTY_MINUTES : 20;
        assert.strictEqual(expected.problemPenalty, expectedPenalty);
        await assertSingleProblemScoringState({
          contestId: contest._id,
          userId,
          contestProblemId: problemId,
          expected,
          submissionIds: [wa._id, ac._id],
        });
      }

      await runBoundary(19, true);
      await runBoundary(20, false);
      await runBoundary(21, false);
    });

    await testCase("ISSUE-605 P1: concurrent 5 Accepted submissions choose earliest canonical", async () => {
      const adminUser = await createAdminUser();
      const participantUser = await createParticipantUser("concurrent-5");
      const question = await createBaseQuestion("concurrent-5");
      const { contest, userId, problemIds } = await createContestContext({
        adminUser,
        participantUser,
        question,
      });
      const problemId = problemIds[0];
      const minuteValues = [5, 10, 15, 20, 25];

      const submissions = [];
      for (const minuteValue of minuteValues) {
        submissions.push(
          await createCompletedSubmission({
            userId,
            questionId: question._id,
            contestId: contest._id,
            contestProblemId: problemId,
            submittedAtContestMs: minutes(minuteValue),
            verdict: JUDGE_VERDICTS.ACCEPTED,
          }),
        );
      }

      await processConcurrently(submissions.map((submission) => submission._id));

      const expected = expectedSingleProblemState(submissions);
      assert.strictEqual(String(expected.canonicalId), String(submissions[0]._id));
      assert.strictEqual(expected.problemPenalty, 5);
      await assertSingleProblemScoringState({
        contestId: contest._id,
        userId,
        contestProblemId: problemId,
        expected,
        submissionIds: submissions.map((submission) => submission._id),
      });
    });

    await testCase("ISSUE-605 P1: concurrent 10 Accepted submissions choose earliest canonical", async () => {
      const adminUser = await createAdminUser();
      const participantUser = await createParticipantUser("concurrent-10");
      const question = await createBaseQuestion("concurrent-10");
      const { contest, userId, problemIds } = await createContestContext({
        adminUser,
        participantUser,
        question,
      });
      const problemId = problemIds[0];

      const submissions = [];
      for (let minuteValue = 1; minuteValue <= 10; minuteValue += 1) {
        submissions.push(
          await createCompletedSubmission({
            userId,
            questionId: question._id,
            contestId: contest._id,
            contestProblemId: problemId,
            submittedAtContestMs: minutes(minuteValue),
            verdict: JUDGE_VERDICTS.ACCEPTED,
          }),
        );
      }

      await processConcurrently(submissions.map((submission) => submission._id));

      const expected = expectedSingleProblemState(submissions);
      assert.strictEqual(String(expected.canonicalId), String(submissions[0]._id));
      assert.strictEqual(expected.problemPenalty, 1);
      assert.strictEqual(expected.lastAcceptedContestMs, minutes(1));
      await assertSingleProblemScoringState({
        contestId: contest._id,
        userId,
        contestProblemId: problemId,
        expected,
        submissionIds: submissions.map((submission) => submission._id),
      });
    });

    await testCase("ISSUE-605 P1: concurrent multi-problem scoring aggregates correctly (2 problems)", async () => {
      const adminUser = await createAdminUser();
      const participantUser = await createParticipantUser("multi-2");
      const question = await createBaseQuestion("multi-2");
      const { contest, userId, problemIds } = await createContestContext({
        adminUser,
        participantUser,
        question,
        problemCount: 2,
      });

      const submissions = [
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemIds[0],
          submittedAtContestMs: minutes(12),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        }),
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemIds[1],
          submittedAtContestMs: minutes(18),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        }),
      ];

      await processConcurrently(submissions.map((submission) => submission._id));

      const expectedProblems = [
        expectedSingleProblemState([submissions[0]]),
        expectedSingleProblemState([submissions[1]]),
      ];
      const expected = expectedMultiProblemState(expectedProblems);
      assert.strictEqual(expected.solvedCount, 2);
      assert.strictEqual(expected.totalPenalty, 12 + 18);
      assert.strictEqual(expected.lastAcceptedContestMs, minutes(18));

      await assertMultiProblemScoringState({
        contestId: contest._id,
        userId,
        problemIds,
        expected: { ...expected, problems: expectedProblems },
        submissionIds: submissions.map((submission) => submission._id),
      });
    });

    await testCase("ISSUE-605 P1: concurrent multi-problem scoring aggregates correctly (3 problems)", async () => {
      const adminUser = await createAdminUser();
      const participantUser = await createParticipantUser("multi-3");
      const question = await createBaseQuestion("multi-3");
      const { contest, userId, problemIds } = await createContestContext({
        adminUser,
        participantUser,
        question,
        problemCount: 3,
      });

      const submissions = [
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemIds[0],
          submittedAtContestMs: minutes(8),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        }),
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemIds[1],
          submittedAtContestMs: minutes(15),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        }),
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemIds[2],
          submittedAtContestMs: minutes(22),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        }),
      ];

      await processConcurrently(submissions.map((submission) => submission._id));

      const expectedProblems = submissions.map((submission) =>
        expectedSingleProblemState([submission]),
      );
      const expected = expectedMultiProblemState(expectedProblems);
      assert.strictEqual(expected.solvedCount, 3);
      assert.strictEqual(expected.totalPenalty, 8 + 15 + 22);
      assert.strictEqual(expected.lastAcceptedContestMs, minutes(22));

      await assertMultiProblemScoringState({
        contestId: contest._id,
        userId,
        problemIds,
        expected: { ...expected, problems: expectedProblems },
        submissionIds: submissions.map((submission) => submission._id),
      });
    });

    await testCase("ISSUE-605 P1: combined concurrent out-of-order AC@50 AC@30 AC@40", async () => {
      const adminUser = await createAdminUser();
      const participantUser = await createParticipantUser("combo-ooo");
      const question = await createBaseQuestion("combo-ooo");
      const { contest, userId, problemIds } = await createContestContext({
        adminUser,
        participantUser,
        question,
      });
      const problemId = problemIds[0];

      const submissions = [
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemId,
          submittedAtContestMs: minutes(50),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        }),
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemId,
          submittedAtContestMs: minutes(30),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        }),
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemId,
          submittedAtContestMs: minutes(40),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        }),
      ];

      await processConcurrently(submissions.map((submission) => submission._id));

      const expected = expectedSingleProblemState(submissions);
      assert.strictEqual(expected.problemPenalty, 30);
      assert.strictEqual(expected.lastAcceptedContestMs, minutes(30));
      await assertSingleProblemScoringState({
        contestId: contest._id,
        userId,
        contestProblemId: problemId,
        expected,
        submissionIds: submissions.map((submission) => submission._id),
      });
    });

    await testCase("ISSUE-605 P1: combined concurrent AC@40 WA@45 AC@20 converges to canonical @20", async () => {
      const adminUser = await createAdminUser();
      const participantUser = await createParticipantUser("combo-wa");
      const question = await createBaseQuestion("combo-wa");
      const { contest, userId, problemIds } = await createContestContext({
        adminUser,
        participantUser,
        question,
      });
      const problemId = problemIds[0];

      const submissions = [
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemId,
          submittedAtContestMs: minutes(40),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        }),
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemId,
          submittedAtContestMs: minutes(45),
          verdict: JUDGE_VERDICTS.WRONG_ANSWER,
        }),
        await createCompletedSubmission({
          userId,
          questionId: question._id,
          contestId: contest._id,
          contestProblemId: problemId,
          submittedAtContestMs: minutes(20),
          verdict: JUDGE_VERDICTS.ACCEPTED,
        }),
      ];

      await processConcurrently(submissions.map((submission) => submission._id));

      const expected = expectedSingleProblemState(submissions);
      assert.strictEqual(expected.problemPenalty, 20);
      await assertSingleProblemScoringState({
        contestId: contest._id,
        userId,
        contestProblemId: problemId,
        expected,
        submissionIds: submissions.map((submission) => submission._id),
      });
    });

    console.log(`\nScoring ordering checks: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      throw new Error(`${failed} scoring ordering checks failed`);
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
