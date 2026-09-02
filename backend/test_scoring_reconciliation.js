const assert = require("assert");
const mongoose = require("mongoose");
const User = require("./models/User");
const Contest = require("./models/Contest");
const Submission = require("./models/Submission");
const ContestParticipant = require("./models/ContestParticipant");
const ContestParticipantProblem = require("./models/ContestParticipantProblem");
const ContestScoredSubmission = require("./models/ContestScoredSubmission");
const {
  JUDGE_VERDICTS,
  SUBMISSION_STATUS,
  SCORING_EFFECT,
  applySubmissionResult,
} = require("@koder/shared");
const {
  reconcileContestScoring,
  reconcileParticipantScoring,
} = require("./services/scoring-reconcile.service");
const ScoringRepository = require("./repositories/scoring.repository");
const SubmissionRepository = require("./repositories/submission.repository");
const fs = require("fs");

const URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/koder_phase6_scoring_reconciliation_test";
const minute = (value) => value * 60 * 1000;
let sequence = 0;

async function resetDb() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(URI);
  }
  await mongoose.connection.dropDatabase();
  await Promise.all([
    User.syncIndexes(),
    Contest.syncIndexes(),
    Submission.syncIndexes(),
    ContestParticipant.syncIndexes(),
    ContestParticipantProblem.syncIndexes(),
    ContestScoredSubmission.syncIndexes(),
  ]);
}

async function fixture(status = "RUNNING", participantCount = 2, problemCount = 2) {
  sequence += 1;
  const admin = await User.create({
    firstName: "Reconcile",
    lastName: "Admin",
    email: `reconcile-admin-${sequence}@example.com`,
    password: "hashed",
    role: "admin",
  });
  const participants = await User.create(
    Array.from({ length: participantCount }, (_, index) => ({
      firstName: "Reconcile",
      lastName: `User${index}`,
      email: `reconcile-user-${sequence}-${index}@example.com`,
      password: "hashed",
    })),
  );
  const contest = await Contest.create({
    title: `Reconciliation Contest ${sequence}`,
    slug: `reconciliation-contest-${sequence}`,
    registrationOpenTime: new Date(Date.now() - 3600000),
    startTime: new Date(Date.now() - 1800000),
    endTime: new Date(Date.now() + 1800000),
    status,
    createdBy: admin._id,
    problems: Array.from({ length: problemCount }, (_, index) => ({
      questionId: new mongoose.Types.ObjectId(),
      order: index + 1,
      points: 100,
      penaltyMinutes: 5,
    })),
  });
  await ContestParticipant.insertMany(
    participants.map((user) => ({ contestId: contest._id, userId: user._id })),
  );
  return { admin, participants, contest };
}

async function submission({ contest, userId, problemId, minutes, verdict, id }) {
  return Submission.create({
    ...(id ? { _id: id } : {}),
    userId,
    questionId: new mongoose.Types.ObjectId(),
    contestId: contest._id,
    contestProblemId: problemId,
    submittedAtContestMs: minute(minutes),
    code: "solution",
    language: "javascript",
    status: SUBMISSION_STATUS.COMPLETED,
    verdict,
  });
}

async function state(contestId, userId) {
  return {
    participant: await ContestParticipant.findOne({ contestId, userId }).lean(),
    problems: await ContestParticipantProblem.find({ contestId, userId })
      .sort({ contestProblemId: 1 })
      .lean(),
  };
}

async function run() {
  await resetDb();
  let passed = 0;
  let failed = 0;
  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  ✗ ${name}\n    ${error.message}`);
      failed += 1;
    }
  }

  await test("rebuilds an empty contest without creating phantom problem rows", async () => {
    const { admin, contest } = await fixture("ENDED", 1, 2);
    const result = await reconcileContestScoring(contest._id, {
      actorUserId: admin._id,
      recoveryReason: "empty contest audit repair",
    });
    assert.strictEqual(result.completed, true);
    assert.strictEqual(await ContestParticipantProblem.countDocuments({ contestId: contest._id }), 0);
    const repaired = await ContestParticipant.findOne({ contestId: contest._id }).lean();
    assert.deepStrictEqual(
      {
        solvedCount: repaired.solvedCount,
        totalPenalty: repaired.totalPenalty,
        lastAcceptedContestMs: repaired.lastAcceptedContestMs,
      },
      { solvedCount: 0, totalPenalty: 0, lastAcceptedContestMs: null },
    );
  });

  await test("rebuilds multiple participants and problems from submission history", async () => {
    const { admin, participants, contest } = await fixture("ENDED", 2, 2);
    const [p1, p2] = contest.problems;
    const wrong = await submission({
      contest,
      userId: participants[0]._id,
      problemId: p1._id,
      minutes: 2,
      verdict: JUDGE_VERDICTS.WRONG_ANSWER,
    });
    const accepted = await submission({
      contest,
      userId: participants[0]._id,
      problemId: p1._id,
      minutes: 10,
      verdict: JUDGE_VERDICTS.ACCEPTED,
    });
    await submission({
      contest,
      userId: participants[1]._id,
      problemId: p2._id,
      minutes: 7,
      verdict: JUDGE_VERDICTS.ACCEPTED,
    });
    const result = await reconcileContestScoring(contest._id, {
      actorUserId: admin._id,
      recoveryReason: "rebuild contest projections",
    });
    assert.strictEqual(result.missingLedgerCount, 3);
    const first = await state(contest._id, participants[0]._id);
    assert.strictEqual(first.participant.solvedCount, 1);
    assert.strictEqual(first.participant.totalPenalty, 15);
    assert.strictEqual(String(first.problems.find((row) => String(row.contestProblemId) === String(p1._id)).firstAcceptedSubmissionId), String(accepted._id));
    assert.strictEqual(await ContestScoredSubmission.countDocuments({ contestId: contest._id }), 3);
    assert.strictEqual((await ContestScoredSubmission.findOne({ submissionId: wrong._id })).effect, SCORING_EFFECT.WRONG);
  });

  await test("dry-run reports drift and performs zero writes", async () => {
    const { admin, participants, contest } = await fixture("RUNNING", 1, 1);
    const problem = contest.problems[0];
    await submission({
      contest,
      userId: participants[0]._id,
      problemId: problem._id,
      minutes: 4,
      verdict: JUDGE_VERDICTS.ACCEPTED,
    });
    const before = {
      participant: await ContestParticipant.findOne({ contestId: contest._id }).lean(),
      problems: await ContestParticipantProblem.countDocuments({ contestId: contest._id }),
      ledger: await ContestScoredSubmission.countDocuments({ contestId: contest._id }),
    };
    const result = await reconcileContestScoring(contest._id, { dryRun: true });
    assert.strictEqual(result.dryRun, true);
    assert.ok(result.problemRepairs > 0);
    assert.deepStrictEqual(
      {
        participant: await ContestParticipant.findOne({ contestId: contest._id }).lean(),
        problems: await ContestParticipantProblem.countDocuments({ contestId: contest._id }),
        ledger: await ContestScoredSubmission.countDocuments({ contestId: contest._id }),
      },
      before,
    );
    assert.ok(admin);
  });

  await test("repairs corrupted problem state, aggregate, and stale ledger effect", async () => {
    const { admin, participants, contest } = await fixture("ENDED", 1, 1);
    const problem = contest.problems[0];
    const accepted = await submission({
      contest,
      userId: participants[0]._id,
      problemId: problem._id,
      minutes: 8,
      verdict: JUDGE_VERDICTS.ACCEPTED,
    });
    await ContestParticipantProblem.create({
      contestId: contest._id,
      userId: participants[0]._id,
      contestProblemId: problem._id,
      solved: true,
      firstAcceptedSubmissionId: new mongoose.Types.ObjectId(),
      firstAcceptedAtContestMs: minute(1),
      problemPenalty: 999,
    });
    await ContestParticipant.updateOne(
      { contestId: contest._id, userId: participants[0]._id },
      { $set: { solvedCount: 99, totalPenalty: 999, lastAcceptedContestMs: minute(1) } },
    );
    await ContestScoredSubmission.create({
      submissionId: accepted._id,
      contestId: contest._id,
      userId: participants[0]._id,
      contestProblemId: problem._id,
      verdict: accepted.verdict,
      submittedAtContestMs: accepted.submittedAtContestMs,
      effect: SCORING_EFFECT.NONE,
    });
    await reconcileContestScoring(contest._id, {
      actorUserId: admin._id,
      recoveryReason: "repair projection drift",
    });
    const repaired = await state(contest._id, participants[0]._id);
    assert.strictEqual(repaired.problems[0].problemPenalty, 8);
    assert.strictEqual(repaired.participant.totalPenalty, 8);
    assert.strictEqual(
      (await ContestScoredSubmission.findOne({ submissionId: accepted._id })).effect,
      SCORING_EFFECT.SOLVE,
    );
  });

  await test("converges with incremental out-of-order scoring and is idempotent", async () => {
    const { admin, participants, contest } = await fixture("RUNNING", 1, 1);
    const problem = contest.problems[0];
    const late = await submission({
      contest,
      userId: participants[0]._id,
      problemId: problem._id,
      minutes: 20,
      verdict: JUDGE_VERDICTS.ACCEPTED,
    });

    await test("fingerprint changes for older in-place scoring-source mutation", async () => {
      const { contest, participants } = await fixture("RUNNING", 1, 1);
      const problem = contest.problems[0];
      const older = await submission({
        contest,
        userId: participants[0]._id,
        problemId: problem._id,
        minutes: 4,
        verdict: JUDGE_VERDICTS.WRONG_ANSWER,
      });
      await submission({
        contest,
        userId: participants[0]._id,
        problemId: problem._id,
        minutes: 8,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const before = await SubmissionRepository.getContestSourceFingerprint(contest._id);
      await Submission.updateOne(
        { _id: older._id },
        { $set: { submittedAtContestMs: minute(5) } },
      );
      const after = await SubmissionRepository.getContestSourceFingerprint(contest._id);
      assert.notStrictEqual(after, before);
    });

    await test("concurrent ledger backfill creates exactly one row", async () => {
      const { admin, participants, contest } = await fixture("ENDED", 1, 1);
      const accepted = await submission({
        contest,
        userId: participants[0]._id,
        problemId: contest.problems[0]._id,
        minutes: 5,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      await Promise.all([
        reconcileContestScoring(contest._id, {
          actorUserId: admin._id,
          recoveryReason: "concurrent recovery one",
        }),
        reconcileContestScoring(contest._id, {
          actorUserId: admin._id,
          recoveryReason: "concurrent recovery two",
        }),
      ]);
      assert.strictEqual(await ContestScoredSubmission.countDocuments({ submissionId: accepted._id }), 1);
    });

    await test("reports corrupted ledger identity without rewriting it", async () => {
      const { admin, participants, contest } = await fixture("ENDED", 1, 1);
      const accepted = await submission({
        contest,
        userId: participants[0]._id,
        problemId: contest.problems[0]._id,
        minutes: 5,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const otherUser = new mongoose.Types.ObjectId();
      await ContestScoredSubmission.create({
        submissionId: accepted._id,
        contestId: contest._id,
        userId: otherUser,
        contestProblemId: contest.problems[0]._id,
        verdict: accepted.verdict,
        submittedAtContestMs: accepted.submittedAtContestMs,
        effect: SCORING_EFFECT.NONE,
      });
      const result = await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "audit corrupted ledger identity",
      });
      assert.strictEqual(result.invalidLedgerIdentityCount, 1);
      const ledger = await ContestScoredSubmission.findOne({ submissionId: accepted._id }).lean();
      assert.strictEqual(String(ledger.userId), String(otherUser));
    });

    await test("reconciliation classifies post-solve wrong and noncanonical Accepted effects", async () => {
      const { admin, participants, contest } = await fixture("ENDED", 1, 1);
      const problem = contest.problems[0];
      const accepted = await submission({
        contest,
        userId: participants[0]._id,
        problemId: problem._id,
        minutes: 5,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const laterAccepted = await submission({
        contest,
        userId: participants[0]._id,
        problemId: problem._id,
        minutes: 7,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const postSolveWrong = await submission({
        contest,
        userId: participants[0]._id,
        problemId: problem._id,
        minutes: 9,
        verdict: JUDGE_VERDICTS.WRONG_ANSWER,
      });
      await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "rebuild ledger effects",
      });
      assert.strictEqual(
        (await ContestScoredSubmission.findOne({ submissionId: accepted._id })).effect,
        SCORING_EFFECT.SOLVE,
      );
      assert.strictEqual(
        (await ContestScoredSubmission.findOne({ submissionId: laterAccepted._id })).effect,
        SCORING_EFFECT.IGNORED_NONCANONICAL_AC,
      );
      assert.strictEqual(
        (await ContestScoredSubmission.findOne({ submissionId: postSolveWrong._id })).effect,
        SCORING_EFFECT.IGNORED_POST_SOLVE,
      );
    });

    await test("failure during problem repair is reported and retry heals it", async () => {
      const { admin, participants, contest } = await fixture("ENDED", 1, 1);
      await submission({
        contest,
        userId: participants[0]._id,
        problemId: contest.problems[0]._id,
        minutes: 3,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const original = ScoringRepository.upsertProblemState;
      let failed = false;
      ScoringRepository.upsertProblemState = async (...args) => {
        if (!failed) {
          failed = true;
          throw new Error("injected problem repair failure");
        }
        return original.apply(ScoringRepository, args);
      };
      const first = await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "test problem repair failure",
      });
      ScoringRepository.upsertProblemState = original;
      assert.strictEqual(first.partialFailure, true);
      const second = await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "retry problem repair",
      });
      assert.strictEqual(second.completed, true);
    });

    await test("dry-run invokes no repository write methods", async () => {
      const { contest, participants } = await fixture("RUNNING", 1, 1);
      await submission({
        contest,
        userId: participants[0]._id,
        problemId: contest.problems[0]._id,
        minutes: 3,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const methods = ["upsertProblemState", "deleteProblemState", "updateParticipantAggregate", "createLedgerEntry", "updateLedgerEffect"];
      const originals = Object.fromEntries(methods.map((name) => [name, ScoringRepository[name]]));
      let writes = 0;
      for (const name of methods) {
        ScoringRepository[name] = async () => {
          writes += 1;
        };
      }
      await reconcileContestScoring(contest._id, { dryRun: true });
      for (const name of methods) {
        ScoringRepository[name] = originals[name];
      }
      assert.strictEqual(writes, 0);
    });

    await test("aggregate repair failure is reported and retry heals without double counting", async () => {
      const { admin, participants, contest } = await fixture("ENDED", 1, 1);
      await submission({
        contest,
        userId: participants[0]._id,
        problemId: contest.problems[0]._id,
        minutes: 6,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      await ContestParticipant.updateOne(
        { contestId: contest._id, userId: participants[0]._id },
        { $set: { solvedCount: 99, totalPenalty: 999, lastAcceptedContestMs: minute(1) } },
      );
      const original = ScoringRepository.updateParticipantAggregate;
      let failed = false;
      ScoringRepository.updateParticipantAggregate = async (...args) => {
        if (!failed) {
          failed = true;
          throw new Error("injected aggregate repair failure");
        }
        return original.apply(ScoringRepository, args);
      };
      const first = await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "test aggregate repair failure",
      });
      ScoringRepository.updateParticipantAggregate = original;
      assert.strictEqual(first.partialFailure, true);
      const second = await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "retry aggregate repair",
      });
      const repaired = await ContestParticipant.findOne({ contestId: contest._id, userId: participants[0]._id }).lean();
      assert.strictEqual(second.completed, true);
      assert.deepStrictEqual(
        {
          solvedCount: repaired.solvedCount,
          totalPenalty: repaired.totalPenalty,
          lastAcceptedContestMs: repaired.lastAcceptedContestMs,
        },
        { solvedCount: 1, totalPenalty: 6, lastAcceptedContestMs: minute(6) },
      );
      assert.strictEqual(await ContestParticipantProblem.countDocuments({ contestId: contest._id }), 1);
    });

    await test("ledger creation failure is reported and retry creates exactly one ledger row", async () => {
      const { admin, participants, contest } = await fixture("ENDED", 1, 1);
      const accepted = await submission({
        contest,
        userId: participants[0]._id,
        problemId: contest.problems[0]._id,
        minutes: 6,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const original = ScoringRepository.createLedgerEntry;
      let failed = false;
      ScoringRepository.createLedgerEntry = async (...args) => {
        if (!failed) {
          failed = true;
          throw new Error("injected ledger creation failure");
        }
        return original.apply(ScoringRepository, args);
      };
      const first = await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "test ledger creation failure",
      });
      ScoringRepository.createLedgerEntry = original;
      assert.strictEqual(first.partialFailure, true);
      const second = await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "retry ledger creation",
      });
      assert.strictEqual(second.completed, true);
      assert.strictEqual(await ContestScoredSubmission.countDocuments({ submissionId: accepted._id }), 1);
    });

    await test("partial participant failure is reported separately and retry converges", async () => {
      const { admin, participants, contest } = await fixture("ENDED", 2, 1);
      await submission({
        contest,
        userId: participants[0]._id,
        problemId: contest.problems[0]._id,
        minutes: 4,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      await submission({
        contest,
        userId: participants[1]._id,
        problemId: contest.problems[0]._id,
        minutes: 5,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const original = ScoringRepository.updateParticipantAggregate;
      let failed = false;
      ScoringRepository.updateParticipantAggregate = async (contestId, userId, aggregate) => {
        if (!failed && String(userId) === String(participants[1]._id)) {
          failed = true;
          throw new Error("injected second participant failure");
        }
        return original.call(ScoringRepository, contestId, userId, aggregate);
      };
      const first = await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "test partial participant failure",
      });
      ScoringRepository.updateParticipantAggregate = original;
      assert.strictEqual(first.partialFailure, true);
      assert.strictEqual(first.completed, false);
      assert.ok(first.errors.some((error) => String(error.userId) === String(participants[1]._id)));
      const second = await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "retry partial participant failure",
      });
      assert.strictEqual(second.completed, true);
      const repaired = await ContestParticipant.find({ contestId: contest._id }).sort({ userId: 1 }).lean();
      assert.deepStrictEqual(repaired.map((entry) => entry.solvedCount), [1, 1]);
    });

    await test("running reconciliation detects a source mutation during the scan", async () => {
      const { admin, participants, contest } = await fixture("RUNNING", 1, 1);
      const accepted = await submission({
        contest,
        userId: participants[0]._id,
        problemId: contest.problems[0]._id,
        minutes: 8,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const original = ScoringRepository.upsertProblemState;
      let mutated = false;
      ScoringRepository.upsertProblemState = async (...args) => {
        const result = await original.apply(ScoringRepository, args);
        if (!mutated) {
          mutated = true;
          await Submission.updateOne(
            { _id: accepted._id },
            { $set: { submittedAtContestMs: minute(9) } },
          );
        }
        return result;
      };
      const result = await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "test running source mutation",
      });
      ScoringRepository.upsertProblemState = original;
      assert.ok(result.passes > 1 || result.unstable || result.incomplete);
    });

    await test("maxPasses exhaustion reports unstable incomplete reconciliation", async () => {
      const { admin, participants, contest } = await fixture("RUNNING", 1, 1);
      const accepted = await submission({
        contest,
        userId: participants[0]._id,
        problemId: contest.problems[0]._id,
        minutes: 8,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      const original = ScoringRepository.upsertProblemState;
      let nextMinute = 9;
      ScoringRepository.upsertProblemState = async (...args) => {
        const result = await original.apply(ScoringRepository, args);
        await Submission.updateOne(
          { _id: accepted._id },
          { $set: { submittedAtContestMs: minute(nextMinute) } },
        );
        nextMinute += 1;
        return result;
      };
      const result = await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "test unstable source",
        maxPasses: 2,
      });
      ScoringRepository.upsertProblemState = original;
      assert.strictEqual(result.unstable, true);
      assert.strictEqual(result.incomplete, true);
      assert.strictEqual(result.completed, false);
    });

    await test("same-millisecond Accepted tie-break and ledger effects are deterministic", async () => {
      const { admin, participants, contest } = await fixture("ENDED", 1, 1);
      const lowerId = new mongoose.Types.ObjectId("000000000000000000000101");
      const higherId = new mongoose.Types.ObjectId("000000000000000000000102");
      const lower = await submission({
        contest,
        userId: participants[0]._id,
        problemId: contest.problems[0]._id,
        minutes: 5,
        verdict: JUDGE_VERDICTS.ACCEPTED,
        id: lowerId,
      });
      const higher = await submission({
        contest,
        userId: participants[0]._id,
        problemId: contest.problems[0]._id,
        minutes: 5,
        verdict: JUDGE_VERDICTS.ACCEPTED,
        id: higherId,
      });
      await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "test same millisecond ordering",
      });
      const problem = await ContestParticipantProblem.findOne({ contestId: contest._id }).lean();
      assert.strictEqual(String(problem.firstAcceptedSubmissionId), String(lower._id));
      assert.strictEqual((await ContestScoredSubmission.findOne({ submissionId: lower._id })).effect, SCORING_EFFECT.SOLVE);
      assert.strictEqual((await ContestScoredSubmission.findOne({ submissionId: higher._id })).effect, SCORING_EFFECT.IGNORED_NONCANONICAL_AC);
    });

    await test("missing aggregate fields and malformed problem metadata are normalized", async () => {
      const { admin, participants, contest } = await fixture("ENDED", 1, 1);
      const problem = contest.problems[0];
      const accepted = await submission({
        contest,
        userId: participants[0]._id,
        problemId: problem._id,
        minutes: 7,
        verdict: JUDGE_VERDICTS.ACCEPTED,
      });
      await ContestParticipantProblem.create({
        contestId: contest._id,
        userId: participants[0]._id,
        contestProblemId: problem._id,
        solved: true,
        firstAcceptedSubmissionId: new mongoose.Types.ObjectId(),
        firstAcceptedAtContestMs: minute(1),
        problemPenalty: 99,
      });
      await ContestParticipant.updateOne(
        { contestId: contest._id, userId: participants[0]._id },
        { $unset: { solvedCount: "", totalPenalty: "", lastAcceptedContestMs: "" } },
      );
      await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "normalize missing scoring fields",
      });
      const repairedParticipant = await ContestParticipant.findOne({ contestId: contest._id }).lean();
      const repairedProblem = await ContestParticipantProblem.findOne({ contestId: contest._id }).lean();
      assert.strictEqual(repairedParticipant.solvedCount, 1);
      assert.strictEqual(repairedParticipant.totalPenalty, 7);
      assert.strictEqual(repairedParticipant.lastAcceptedContestMs, minute(7));
      assert.strictEqual(String(repairedProblem.firstAcceptedSubmissionId), String(accepted._id));
      assert.strictEqual(repairedProblem.firstAcceptedAtContestMs, minute(7));
      assert.strictEqual(repairedProblem.problemPenalty, 7);
    });

    await test("unsolved rows with solve metadata are normalized to the unsolved representation", async () => {
      const { admin, participants, contest } = await fixture("ENDED", 1, 1);
      const problem = contest.problems[0];
      await ContestParticipantProblem.collection.insertOne({
        contestId: contest._id,
        userId: participants[0]._id,
        contestProblemId: problem._id,
        solved: false,
        firstAcceptedSubmissionId: new mongoose.Types.ObjectId(),
        firstAcceptedAtContestMs: minute(4),
        problemPenalty: 20,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await reconcileContestScoring(contest._id, {
        actorUserId: admin._id,
        recoveryReason: "normalize unsolved metadata",
      });
      const repaired = await ContestParticipantProblem.findOne({ contestId: contest._id }).lean();
      assert.strictEqual(repaired.solved, false);
      assert.strictEqual(repaired.firstAcceptedSubmissionId, null);
      assert.strictEqual(repaired.firstAcceptedAtContestMs, null);
      assert.strictEqual(repaired.problemPenalty, 0);
    });

    await test("reconciliation submission query projects only scoring fields", async () => {
      const source = fs.readFileSync(
        require.resolve("./repositories/submission.repository"),
        "utf8",
      );
      assert.match(
        source,
        /\.select\("_id userId contestId contestProblemId verdict status submittedAtContestMs updatedAt"\)/,
      );
      assert.doesNotMatch(source, /\.select\([^)]*\bcode\b/);
    });
    const early = await submission({
      contest,
      userId: participants[0]._id,
      problemId: problem._id,
      minutes: 10,
      verdict: JUDGE_VERDICTS.ACCEPTED,
    });
    await applySubmissionResult(late._id);
    await applySubmissionResult(early._id);
    const first = await reconcileParticipantScoring(contest._id, participants[0]._id, {
      actorUserId: admin._id,
      recoveryReason: "verify participant convergence",
    });
    const snapshot = await state(contest._id, participants[0]._id);
    const second = await reconcileParticipantScoring(contest._id, participants[0]._id, {
      actorUserId: admin._id,
      recoveryReason: "verify idempotent retry",
    });
    assert.strictEqual(first.completed, true);
    assert.strictEqual(second.problemRepairs, 0);
    assert.strictEqual(second.aggregateRepairs, 0);
    assert.deepStrictEqual((await state(contest._id, participants[0]._id)).participant, snapshot.participant);
  });

  await test("participant scope leaves other participants untouched", async () => {
    const { admin, participants, contest } = await fixture("ENDED", 2, 1);
    const problem = contest.problems[0];
    await submission({
      contest,
      userId: participants[1]._id,
      problemId: problem._id,
      minutes: 6,
      verdict: JUDGE_VERDICTS.ACCEPTED,
    });
    await ContestParticipant.updateOne(
      { contestId: contest._id, userId: participants[1]._id },
      { $set: { solvedCount: 77 } },
    );
    const before = await ContestParticipant.findOne({ contestId: contest._id, userId: participants[1]._id }).lean();
    await reconcileParticipantScoring(contest._id, participants[0]._id, {
      actorUserId: admin._id,
      recoveryReason: "repair one participant",
    });
    const after = await ContestParticipant.findOne({ contestId: contest._id, userId: participants[1]._id }).lean();
    assert.strictEqual(after.solvedCount, before.solvedCount);
  });

  await test("reports invalid source data and removes orphaned inactive problem rows", async () => {
    const { admin, participants, contest } = await fixture("ENDED", 1, 1);
    await submission({
      contest,
      userId: participants[0]._id,
      problemId: new mongoose.Types.ObjectId(),
      minutes: 3,
      verdict: JUDGE_VERDICTS.ACCEPTED,
    });
    const orphanId = new mongoose.Types.ObjectId();
    await ContestParticipantProblem.create({
      contestId: contest._id,
      userId: participants[0]._id,
      contestProblemId: orphanId,
      solved: false,
    });
    const result = await reconcileContestScoring(contest._id, {
      actorUserId: admin._id,
      recoveryReason: "report malformed source and orphan state",
    });
    assert.strictEqual(result.invalidSourceCount, 1);
    assert.strictEqual(result.incomplete, true);
    assert.strictEqual(result.orphanedProblemStateCount, 1);
    assert.strictEqual(
      await ContestParticipantProblem.countDocuments({
        contestId: contest._id,
        contestProblemId: orphanId,
      }),
      0,
    );
  });

  await test("finalized contests are audit-only and mutating calls require admin and reason", async () => {
    const { admin, participants, contest } = await fixture("FINALIZED", 1, 1);
    const audit = await reconcileContestScoring(contest._id, { dryRun: true });
    assert.strictEqual(audit.dryRun, true);
    await assert.rejects(
      () => reconcileContestScoring(contest._id, { actorUserId: admin._id, recoveryReason: "repair" }),
      /audit-only/i,
    );
    await assert.rejects(
      () => reconcileParticipantScoring(contest._id, participants[0]._id, { actorUserId: admin._id }),
      /audit-only/i,
    );
    const nonAdmin = await User.create({
      firstName: "Not",
      lastName: "Admin",
      email: `not-admin-${sequence}@example.com`,
      password: "hashed",
    });
    const ended = await fixture("ENDED", 1, 1);
    await assert.rejects(
      () => reconcileContestScoring(ended.contest._id, { actorUserId: nonAdmin._id, recoveryReason: "x" }),
      /Only admins/i,
    );
    await assert.rejects(
      () => reconcileContestScoring(ended.contest._id, { actorUserId: admin._id }),
      /recoveryReason/i,
    );
  });

  console.log(`\nScoring reconciliation checks: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
