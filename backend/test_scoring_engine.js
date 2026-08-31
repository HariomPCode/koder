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
  SCORING_EFFECT,
  applySubmissionResult,
  updateSubmission,
} = require("@koder/shared");

const DEFAULT_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/koder_phase6_scoring_engine_test";

const MS_PER_MINUTE = 60 * 1000;
const PENALTY_MINUTES = 5;

function minutes(ms) {
  return ms * MS_PER_MINUTE;
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
    Submission.syncIndexes(),
  ]);
}

async function createFixture() {
  const adminUser = await User.create({
    firstName: "Scoring",
    lastName: "Admin",
    email: "scoring.admin@example.com",
    password: "hashed-password",
    role: "admin",
  });

  const participantUser = await User.create({
    firstName: "Scoring",
    lastName: "Player",
    email: "scoring.player@example.com",
    password: "hashed-password",
  });

  const foreignUser = await User.create({
    firstName: "Scoring",
    lastName: "Foreign",
    email: "scoring.foreign@example.com",
    password: "hashed-password",
  });

  const questionA = await Question.create({
    questionNum: 601,
    title: "Scoring Problem A",
    slug: "scoring-problem-a",
    difficulty: "Easy",
    description: "Problem A",
    starterCode: [{ language: "javascript", code: "function solve() {}" }],
    functionName: "solve",
    parameters: [{ name: "input", type: "string" }],
    returnType: "string",
    constraints: ["1 <= n <= 10^5"],
    tags: ["scoring"],
  });

  const questionB = await Question.create({
    questionNum: 602,
    title: "Scoring Problem B",
    slug: "scoring-problem-b",
    difficulty: "Medium",
    description: "Problem B",
    starterCode: [{ language: "javascript", code: "function solve() {}" }],
    functionName: "solve",
    parameters: [{ name: "input", type: "string" }],
    returnType: "string",
    constraints: ["1 <= n <= 10^5"],
    tags: ["scoring"],
  });

  const now = Date.now();
  const contest = await Contest.create({
    title: "Scoring Integration Contest",
    slug: "scoring-integration-contest",
    description: "Phase 6 scoring engine integration tests",
    registrationOpenTime: new Date(now - 3 * 60 * 60 * 1000),
    startTime: new Date(now - 2 * 60 * 60 * 1000),
    endTime: new Date(now + 2 * 60 * 60 * 1000),
    status: "RUNNING",
    createdBy: adminUser._id,
    problems: [
      {
        questionId: questionA._id,
        order: 1,
        points: 100,
        penaltyMinutes: PENALTY_MINUTES,
      },
      {
        questionId: questionB._id,
        order: 2,
        points: 200,
        penaltyMinutes: PENALTY_MINUTES,
      },
    ],
  });

  const otherContest = await Contest.create({
    title: "Other Contest",
    slug: "other-scoring-contest",
    description: "Foreign contest boundary",
    registrationOpenTime: new Date(now - 3 * 60 * 60 * 1000),
    startTime: new Date(now - 2 * 60 * 60 * 1000),
    endTime: new Date(now + 2 * 60 * 60 * 1000),
    status: "RUNNING",
    createdBy: adminUser._id,
    problems: [
      {
        questionId: questionA._id,
        order: 1,
        points: 100,
        penaltyMinutes: PENALTY_MINUTES,
      },
    ],
  });

  await ContestParticipant.create({
    contestId: contest._id,
    userId: participantUser._id,
    registeredAt: new Date(),
  });

  const problemAId = contest.problems[0]._id;
  const problemBId = contest.problems[1]._id;
  const foreignProblemId = otherContest.problems[0]._id;

  return {
    adminUser,
    participantUser,
    foreignUser,
    questionA,
    questionB,
    contest,
    otherContest,
    problemAId,
    problemBId,
    foreignProblemId,
  };
}

async function createCompletedSubmission({
  userId,
  questionId,
  contestId,
  contestProblemId,
  submittedAtContestMs,
  verdict,
  status = SUBMISSION_STATUS.COMPLETED,
}) {
  return Submission.create({
    userId,
    questionId,
    contestId,
    contestProblemId,
    submittedAtContestMs,
    code: "console.log('test')",
    language: "javascript",
    status,
    verdict,
    passedTestCases: verdict === JUDGE_VERDICTS.ACCEPTED ? 1 : 0,
    totalTestCases: 1,
  });
}

async function createRunningSubmission({
  userId,
  questionId,
  contestId,
  contestProblemId,
  submittedAtContestMs,
}) {
  return Submission.create({
    userId,
    questionId,
    contestId,
    contestProblemId,
    submittedAtContestMs,
    code: "console.log('test')",
    language: "javascript",
    status: SUBMISSION_STATUS.RUNNING,
  });
}

async function getParticipantState(contestId, userId) {
  return ContestParticipant.findOne({ contestId, userId }).lean();
}

async function getProblemState(contestId, userId, contestProblemId) {
  return ContestParticipantProblem.findOne({ contestId, userId, contestProblemId }).lean();
}

async function runTests() {
  try {
    await resetDb();
    const fixture = await createFixture();

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
        if (error.stack) {
          console.log(`    ${error.stack.split("\n").slice(1, 3).join("\n")}`);
        }
        failed += 1;
      }
    }

    await testCase("FIRST ACCEPTED: AC @ 10 minutes sets canonical solve and aggregate", async () => {
      const submission = await createCompletedSubmission({
        userId: fixture.participantUser._id,
        questionId: fixture.questionA._id,
        contestId: fixture.contest._id,
        contestProblemId: fixture.problemAId,
        submittedAtContestMs: minutes(10),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      const result = await applySubmissionResult(submission._id);
      assert.strictEqual(result.processed, true);
      assert.strictEqual(result.effect, SCORING_EFFECT.SOLVE);

      const problem = await getProblemState(
        fixture.contest._id,
        fixture.participantUser._id,
        fixture.problemAId,
      );
      assert.strictEqual(problem.solved, true);
      assert.strictEqual(String(problem.firstAcceptedSubmissionId), String(submission._id));
      assert.strictEqual(problem.firstAcceptedAtContestMs, minutes(10));
      assert.strictEqual(problem.problemPenalty, 10);

      const participant = await getParticipantState(fixture.contest._id, fixture.participantUser._id);
      assert.strictEqual(participant.solvedCount, 1);
      assert.strictEqual(participant.totalPenalty, 10);
      assert.strictEqual(participant.lastAcceptedContestMs, minutes(10));
    });

    await testCase("WA → AC: one wrong attempt before solve", async () => {
      const contest = await Contest.create({
        title: "WA AC Contest",
        slug: "wa-ac-contest",
        description: "WA then AC",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionB._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      const user = await User.create({
        firstName: "WA",
        lastName: "AC",
        email: "waac@example.com",
        password: "hashed-password",
      });
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user._id,
        registeredAt: new Date(),
      });

      const wa = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionB._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(5),
        verdict: JUDGE_VERDICTS.WRONG_ANSWER,
      });
      await applySubmissionResult(wa._id);

      const ac = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionB._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(10),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const solveResult = await applySubmissionResult(ac._id);
      assert.strictEqual(solveResult.effect, SCORING_EFFECT.SOLVE);

      const problem = await getProblemState(contest._id, user._id, problemId);
      assert.strictEqual(String(problem.firstAcceptedSubmissionId), String(ac._id));
      assert.strictEqual(problem.problemPenalty, 10 + PENALTY_MINUTES);

      const participant = await getParticipantState(contest._id, user._id);
      assert.strictEqual(participant.solvedCount, 1);
      assert.strictEqual(participant.totalPenalty, 10 + PENALTY_MINUTES);
    });

    await testCase("MULTIPLE WA → AC: two wrong attempts counted once at solve", async () => {
      const contest = await Contest.create({
        title: "Multi WA Contest",
        slug: "multi-wa-contest",
        description: "Multiple WA test",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      await ContestParticipant.create({
        contestId: contest._id,
        userId: fixture.foreignUser._id,
        registeredAt: new Date(),
      });

      const wa1 = await createCompletedSubmission({
        userId: fixture.foreignUser._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(2),
        verdict: JUDGE_VERDICTS.WRONG_ANSWER,
      });
      const wa2 = await createCompletedSubmission({
        userId: fixture.foreignUser._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(5),
        verdict: JUDGE_VERDICTS.WRONG_ANSWER,
      });
      const ac = await createCompletedSubmission({
        userId: fixture.foreignUser._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(10),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      await applySubmissionResult(wa1._id);
      await applySubmissionResult(wa2._id);
      await applySubmissionResult(ac._id);

      const problem = await getProblemState(contest._id, fixture.foreignUser._id, problemId);
      assert.strictEqual(problem.problemPenalty, 10 + 2 * PENALTY_MINUTES);

      const participant = await getParticipantState(contest._id, fixture.foreignUser._id);
      assert.strictEqual(participant.solvedCount, 1);
      assert.strictEqual(participant.totalPenalty, 10 + 2 * PENALTY_MINUTES);
    });

    await testCase("AC → WA: post-solve WA does not change state or penalty", async () => {
      const contest = await Contest.create({
        title: "AC WA Contest",
        slug: "ac-wa-contest",
        description: "AC then WA",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      const user = await User.create({
        firstName: "AC",
        lastName: "WA",
        email: "acwa@example.com",
        password: "hashed-password",
      });
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user._id,
        registeredAt: new Date(),
      });

      const ac = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(10),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const wa = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(15),
        verdict: JUDGE_VERDICTS.WRONG_ANSWER,
      });

      await applySubmissionResult(ac._id);
      const before = await getParticipantState(contest._id, user._id);
      const waResult = await applySubmissionResult(wa._id);

      assert.strictEqual(waResult.effect, SCORING_EFFECT.IGNORED_POST_SOLVE);
      const after = await getParticipantState(contest._id, user._id);
      assert.deepStrictEqual(
        {
          solvedCount: after.solvedCount,
          totalPenalty: after.totalPenalty,
          lastAcceptedContestMs: after.lastAcceptedContestMs,
        },
        {
          solvedCount: before.solvedCount,
          totalPenalty: before.totalPenalty,
          lastAcceptedContestMs: before.lastAcceptedContestMs,
        },
      );
    });

    await testCase("AC → LATER AC: first AC remains canonical", async () => {
      const contest = await Contest.create({
        title: "Later AC Contest",
        slug: "later-ac-contest",
        description: "Later AC ignored",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      const user = await User.create({
        firstName: "Later",
        lastName: "AC",
        email: "laterac@example.com",
        password: "hashed-password",
      });
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user._id,
        registeredAt: new Date(),
      });

      const firstAc = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(10),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      await applySubmissionResult(firstAc._id);
      const laterAc = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(20),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const laterResult = await applySubmissionResult(laterAc._id);

      assert.strictEqual(laterResult.effect, SCORING_EFFECT.IGNORED_NONCANONICAL_AC);
      const problem = await getProblemState(contest._id, user._id, problemId);
      assert.strictEqual(String(problem.firstAcceptedSubmissionId), String(firstAc._id));
      const participant = await getParticipantState(contest._id, user._id);
      assert.strictEqual(participant.solvedCount, 1);
      assert.strictEqual(participant.totalPenalty, 10);
    });

    await testCase("OUT-OF-ORDER AC: later processing corrects canonical to earlier AC", async () => {
      const contest = await Contest.create({
        title: "Out Of Order Contest",
        slug: "out-of-order-contest",
        description: "Out of order AC",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      const user = await User.create({
        firstName: "Out",
        lastName: "Order",
        email: "outorder@example.com",
        password: "hashed-password",
      });
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user._id,
        registeredAt: new Date(),
      });

      const ac40 = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(40),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      const firstPass = await applySubmissionResult(ac40._id);
      assert.strictEqual(firstPass.effect, SCORING_EFFECT.SOLVE);

      let problem = await getProblemState(contest._id, user._id, problemId);
      assert.strictEqual(problem.firstAcceptedAtContestMs, minutes(40));
      assert.strictEqual(problem.problemPenalty, 40);

      const ac35 = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(35),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      const secondPass = await applySubmissionResult(ac35._id);
      assert.strictEqual(secondPass.effect, SCORING_EFFECT.SOLVE);
      assert.strictEqual(secondPass.solveResult.corrected, true);

      problem = await getProblemState(contest._id, user._id, problemId);
      assert.strictEqual(String(problem.firstAcceptedSubmissionId), String(ac35._id));
      assert.strictEqual(problem.firstAcceptedAtContestMs, minutes(35));
      assert.strictEqual(problem.problemPenalty, 35);

      const participant = await getParticipantState(contest._id, user._id);
      assert.strictEqual(participant.solvedCount, 1);
      assert.strictEqual(participant.totalPenalty, 35);
      assert.strictEqual(participant.lastAcceptedContestMs, minutes(35));
    });

    await testCase("DUPLICATE ACCEPTED: replay does not double-count aggregates or ledger", async () => {
      const contest = await Contest.create({
        title: "Duplicate AC Contest",
        slug: "duplicate-ac-contest",
        description: "Duplicate AC",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      const user = await User.create({
        firstName: "Dup",
        lastName: "AC",
        email: "dupac@example.com",
        password: "hashed-password",
      });
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user._id,
        registeredAt: new Date(),
      });

      const ac = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(12),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      await applySubmissionResult(ac._id);
      await applySubmissionResult(ac._id);
      await applySubmissionResult(ac._id);

      const ledgerCount = await ContestScoredSubmission.countDocuments({ submissionId: ac._id });
      assert.strictEqual(ledgerCount, 1);

      const participant = await getParticipantState(contest._id, user._id);
      assert.strictEqual(participant.solvedCount, 1);
      assert.strictEqual(participant.totalPenalty, 12);
    });

    await testCase("DUPLICATE WRONG ANSWER: replay is ledger-idempotent with no aggregate drift", async () => {
      const contest = await Contest.create({
        title: "Duplicate WA Contest",
        slug: "duplicate-wa-contest",
        description: "Duplicate WA",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      const user = await User.create({
        firstName: "Dup",
        lastName: "WA",
        email: "dupwa@example.com",
        password: "hashed-password",
      });
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user._id,
        registeredAt: new Date(),
      });

      const wa = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(3),
        verdict: JUDGE_VERDICTS.WRONG_ANSWER,
      });

      await applySubmissionResult(wa._id);
      await applySubmissionResult(wa._id);

      const ledgerCount = await ContestScoredSubmission.countDocuments({ submissionId: wa._id });
      assert.strictEqual(ledgerCount, 1);

      const participant = await getParticipantState(contest._id, user._id);
      assert.strictEqual(participant.solvedCount, 0);
      assert.strictEqual(participant.totalPenalty, 0);
    });

    await testCase("CONCURRENT FIRST AC RACE: one solve and one canonical winner", async () => {
      const contest = await Contest.create({
        title: "Concurrent AC Contest",
        slug: "concurrent-ac-contest",
        description: "Concurrent first AC",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      const user = await User.create({
        firstName: "Race",
        lastName: "User",
        email: "raceuser@example.com",
        password: "hashed-password",
      });
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user._id,
        registeredAt: new Date(),
      });

      const earlierAc = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(8),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const laterAc = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(12),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      await Promise.all([
        applySubmissionResult(earlierAc._id),
        applySubmissionResult(laterAc._id),
      ]);

      const problem = await getProblemState(contest._id, user._id, problemId);
      assert.strictEqual(problem.solved, true);
      assert.strictEqual(String(problem.firstAcceptedSubmissionId), String(earlierAc._id));
      assert.strictEqual(problem.firstAcceptedAtContestMs, minutes(8));
      assert.strictEqual(problem.problemPenalty, 8);

      const participant = await getParticipantState(contest._id, user._id);
      assert.strictEqual(participant.solvedCount, 1);
      assert.strictEqual(participant.totalPenalty, 8);

      const ledgerCount = await ContestScoredSubmission.countDocuments({
        contestId: contest._id,
        userId: user._id,
        contestProblemId: problemId,
      });
      assert.strictEqual(ledgerCount, 2);
    });

    await testCase("SAME-MILLISECOND WA/AC: WA not counted; AC wins by submissionId tie-break", async () => {
      const contest = await Contest.create({
        title: "Same Ms Contest",
        slug: "same-ms-contest",
        description: "Same millisecond WA/AC",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      const user = await User.create({
        firstName: "Same",
        lastName: "Ms",
        email: "samems@example.com",
        password: "hashed-password",
      });
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user._id,
        registeredAt: new Date(),
      });

      const sameMs = minutes(7);
      const wa = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: sameMs,
        verdict: JUDGE_VERDICTS.WRONG_ANSWER,
      });
      await applySubmissionResult(wa._id);

      const ac = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: sameMs,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      await applySubmissionResult(ac._id);

      const problem = await getProblemState(contest._id, user._id, problemId);
      assert.strictEqual(String(problem.firstAcceptedSubmissionId), String(ac._id));
      assert.strictEqual(problem.problemPenalty, 7);
      const participant = await getParticipantState(contest._id, user._id);
      assert.strictEqual(participant.totalPenalty, 7);
    });

    await testCase("NULL submittedAtContestMs: scoring rejected with no state mutation", async () => {
      const contest = await Contest.create({
        title: "Null Timing Contest",
        slug: "null-timing-contest",
        description: "Null timing",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      const user = await User.create({
        firstName: "Null",
        lastName: "Timing",
        email: "nulltiming@example.com",
        password: "hashed-password",
      });
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user._id,
        registeredAt: new Date(),
      });

      const submission = await Submission.create({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: null,
        code: "console.log('test')",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      const result = await applySubmissionResult(submission._id);
      assert.strictEqual(result.processed, false);
      assert.strictEqual(result.reason, "missing_submitted_at_contest_ms");

      const ledgerCount = await ContestScoredSubmission.countDocuments({ submissionId: submission._id });
      assert.strictEqual(ledgerCount, 0);
      const problem = await getProblemState(contest._id, user._id, problemId);
      assert.strictEqual(problem, null);
    });

    await testCase("PRACTICE SUBMISSION: scoring bypassed", async () => {
      const practiceUser = await User.create({
        firstName: "Practice",
        lastName: "Only",
        email: "practice.only@example.com",
        password: "hashed-password",
      });

      const submission = await Submission.create({
        userId: practiceUser._id,
        questionId: fixture.questionA._id,
        contestId: null,
        contestProblemId: null,
        submittedAtContestMs: null,
        code: "console.log('practice')",
        language: "javascript",
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      const result = await applySubmissionResult(submission._id);
      assert.strictEqual(result.processed, false);
      assert.strictEqual(result.reason, "practice_submission");

      const practiceLedger = await ContestScoredSubmission.countDocuments({ submissionId: submission._id });
      assert.strictEqual(practiceLedger, 0);
    });

    await testCase("FOREIGN CONTEST PROBLEM: invalid contestProblemId rejected", async () => {
      const submission = await createCompletedSubmission({
        userId: fixture.participantUser._id,
        questionId: fixture.questionA._id,
        contestId: fixture.contest._id,
        contestProblemId: fixture.foreignProblemId,
        submittedAtContestMs: minutes(9),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      const result = await applySubmissionResult(submission._id);
      assert.strictEqual(result.processed, false);
      assert.strictEqual(result.reason, "invalid_contest_problem");

      const ledgerCount = await ContestScoredSubmission.countDocuments({ submissionId: submission._id });
      assert.strictEqual(ledgerCount, 0);
    });

    await testCase("FOREIGN USER: unregistered participant rejected", async () => {
      const contest = await Contest.create({
        title: "Foreign User Contest",
        slug: "foreign-user-contest",
        description: "Foreign user",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      const unregistered = await User.create({
        firstName: "Unregistered",
        lastName: "User",
        email: "unregistered@example.com",
        password: "hashed-password",
      });

      const submission = await createCompletedSubmission({
        userId: unregistered._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(6),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      const result = await applySubmissionResult(submission._id);
      assert.strictEqual(result.processed, false);
      assert.strictEqual(result.reason, "participant_not_registered");
      assert.strictEqual(await ContestScoredSubmission.countDocuments({ submissionId: submission._id }), 0);
    });

    await testCase("NON-TERMINAL RESULT: queued/running submissions are not scored", async () => {
      const contest = await Contest.create({
        title: "Non Terminal Contest",
        slug: "non-terminal-contest",
        description: "Non terminal",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      const user = await User.create({
        firstName: "Non",
        lastName: "Terminal",
        email: "nonterminal@example.com",
        password: "hashed-password",
      });
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user._id,
        registeredAt: new Date(),
      });

      for (const status of [SUBMISSION_STATUS.QUEUED, SUBMISSION_STATUS.RUNNING, SUBMISSION_STATUS.CREATED]) {
        const submission = await Submission.create({
          userId: user._id,
          questionId: fixture.questionA._id,
          contestId: contest._id,
          contestProblemId: problemId,
          submittedAtContestMs: minutes(4),
          code: "console.log('test')",
          language: "javascript",
          status,
          verdict: JUDGE_VERDICTS.ACCEPTED,
        });

        const result = await applySubmissionResult(submission._id);
        assert.strictEqual(result.processed, false, `status ${status} should not score`);
        assert.strictEqual(result.reason, "submission_not_terminal");
      }
    });

    await testCase("PARTICIPANT AGGREGATE: multiple solved problems roll up correctly", async () => {
      const contest = await Contest.create({
        title: "Aggregate Contest",
        slug: "aggregate-contest",
        description: "Aggregate rollup",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
          {
            questionId: fixture.questionB._id,
            order: 2,
            points: 200,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problem1 = contest.problems[0]._id;
      const problem2 = contest.problems[1]._id;
      const user = await User.create({
        firstName: "Aggregate",
        lastName: "User",
        email: "aggregate@example.com",
        password: "hashed-password",
      });
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user._id,
        registeredAt: new Date(),
      });

      const p1wa = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problem1,
        submittedAtContestMs: minutes(5),
        verdict: JUDGE_VERDICTS.WRONG_ANSWER,
      });
      const p1ac = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problem1,
        submittedAtContestMs: minutes(20),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const p2ac = await createCompletedSubmission({
        userId: user._id,
        questionId: fixture.questionB._id,
        contestId: contest._id,
        contestProblemId: problem2,
        submittedAtContestMs: minutes(30),
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });

      await applySubmissionResult(p1wa._id);
      await applySubmissionResult(p1ac._id);
      await applySubmissionResult(p2ac._id);

      const participant = await getParticipantState(contest._id, user._id);
      assert.strictEqual(participant.solvedCount, 2);
      assert.strictEqual(participant.totalPenalty, 20 + PENALTY_MINUTES + 30);
      assert.strictEqual(participant.lastAcceptedContestMs, minutes(30));
    });

    await testCase("PARTIAL FAILURE + RETRY: scoring retry is idempotent after persisted judge result", async () => {
      const contest = await Contest.create({
        title: "Retry Contest",
        slug: "retry-contest",
        description: "Retry scoring",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      const user = await User.create({
        firstName: "Retry",
        lastName: "User",
        email: "retry@example.com",
        password: "hashed-password",
      });
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user._id,
        registeredAt: new Date(),
      });

      const submission = await createRunningSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(11),
      });

      const persisted = await updateSubmission(submission._id, {
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
        passed: 1,
        total: 1,
        totalRuntime: 12,
        maxRuntime: 12,
        memory: 32,
        failedTestCase: null,
        errorMessage: null,
      });
      assert.ok(persisted);
      assert.strictEqual(persisted.status, SUBMISSION_STATUS.COMPLETED);

      const afterFirst = await getParticipantState(contest._id, user._id);
      assert.strictEqual(afterFirst.solvedCount, 1);
      assert.strictEqual(afterFirst.totalPenalty, 11);

      const retryViaUpdate = await updateSubmission(submission._id, {
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
        passed: 1,
        total: 1,
        totalRuntime: 12,
        maxRuntime: 12,
        memory: 32,
        failedTestCase: null,
        errorMessage: null,
      });
      assert.strictEqual(retryViaUpdate, null);

      const afterRetry = await getParticipantState(contest._id, user._id);
      assert.strictEqual(afterRetry.solvedCount, 1);
      assert.strictEqual(afterRetry.totalPenalty, 11);
      assert.strictEqual(await ContestScoredSubmission.countDocuments({ submissionId: submission._id }), 1);

      await applySubmissionResult(submission._id);
      const afterManualRetry = await getParticipantState(contest._id, user._id);
      assert.strictEqual(afterManualRetry.solvedCount, 1);
      assert.strictEqual(afterManualRetry.totalPenalty, 11);
    });

    await testCase("WORKER → SCORING PATH: updateSubmission triggers contest scoring hook", async () => {
      const contest = await Contest.create({
        title: "Worker Path Contest",
        slug: "worker-path-contest",
        description: "Worker integration path",
        registrationOpenTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "RUNNING",
        createdBy: fixture.adminUser._id,
        problems: [
          {
            questionId: fixture.questionA._id,
            order: 1,
            points: 100,
            penaltyMinutes: PENALTY_MINUTES,
          },
        ],
      });
      const problemId = contest.problems[0]._id;
      const user = await User.create({
        firstName: "Worker",
        lastName: "Path",
        email: "workerpath@example.com",
        password: "hashed-password",
      });
      await ContestParticipant.create({
        contestId: contest._id,
        userId: user._id,
        registeredAt: new Date(),
      });

      const running = await createRunningSubmission({
        userId: user._id,
        questionId: fixture.questionA._id,
        contestId: contest._id,
        contestProblemId: problemId,
        submittedAtContestMs: minutes(18),
      });

      const updated = await updateSubmission(running._id, {
        status: SUBMISSION_STATUS.COMPLETED,
        verdict: JUDGE_VERDICTS.ACCEPTED,
        passed: 1,
        total: 1,
        totalRuntime: 20,
        maxRuntime: 20,
        memory: 48,
        failedTestCase: null,
        errorMessage: null,
      });

      assert.ok(updated);
      assert.strictEqual(updated.verdict, JUDGE_VERDICTS.ACCEPTED);

      const problem = await getProblemState(contest._id, user._id, problemId);
      assert.strictEqual(problem.solved, true);
      assert.strictEqual(String(problem.firstAcceptedSubmissionId), String(running._id));
      assert.strictEqual(problem.problemPenalty, 18);

      const participant = await getParticipantState(contest._id, user._id);
      assert.strictEqual(participant.solvedCount, 1);
      assert.strictEqual(participant.totalPenalty, 18);

      const ledger = await ContestScoredSubmission.findOne({ submissionId: running._id }).lean();
      assert.ok(ledger);
      assert.strictEqual(ledger.effect, SCORING_EFFECT.SOLVE);
    });

    console.log(`\nScoring engine integration checks: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      throw new Error(`${failed} scoring engine integration checks failed`);
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
