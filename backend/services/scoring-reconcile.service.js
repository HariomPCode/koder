const User = require("../models/User");
const ScoringRepository = require("../repositories/scoring.repository");
const SubmissionRepository = require("../repositories/submission.repository");
const {
  SUBMISSION_STATUS,
  SCORING_EFFECT,
  JUDGE_VERDICTS,
  isWrongAttemptVerdict,
  isSolvingVerdict,
  pickCanonicalAcceptedSubmission,
  countWrongAttemptsBeforeSolve,
  calculateProblemPenalty,
} = require("@koder/shared");

const MUTABLE_CONTEST_STATUSES = new Set(["RUNNING", "ENDED"]);
const AUDIT_ONLY_CONTEST_STATUS = "FINALIZED";
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_PASSES = 3;

function duplicateKey(error) {
  return Boolean(error && (error.code === 11000 || error.code === 11001));
}

function nonEmptyReason(reason) {
  return typeof reason === "string" && reason.trim().length > 0;
}

function idsEqual(a, b) {
  return String(a) === String(b);
}

function sourceIsValid(submission, contestProblemIds) {
  if (!submission.contestProblemId || !contestProblemIds.has(String(submission.contestProblemId))) {
    return "missing_or_invalid_contest_problem";
  }
  if (!Number.isFinite(submission.submittedAtContestMs) || submission.submittedAtContestMs < 0) {
    return "invalid_submitted_at_contest_ms";
  }
  if (!Object.values(JUDGE_VERDICTS).includes(submission.verdict)) {
    return "invalid_verdict";
  }
  if (submission.status !== SUBMISSION_STATUS.COMPLETED) {
    return "non_terminal_source";
  }
  return null;
}

function expectedProblemState(submissions, penaltyMinutes) {
  const canonical = pickCanonicalAcceptedSubmission(submissions);
  if (!canonical) {
    return {
      solved: false,
      firstAcceptedSubmissionId: null,
      firstAcceptedAtContestMs: null,
      problemPenalty: 0,
      canonical,
    };
  }

  const wrongAttempts = countWrongAttemptsBeforeSolve(
    submissions,
    canonical.submittedAtContestMs,
  );
  return {
    solved: true,
    firstAcceptedSubmissionId: canonical._id,
    firstAcceptedAtContestMs: canonical.submittedAtContestMs,
    problemPenalty: calculateProblemPenalty({
      firstAcceptedAtContestMs: canonical.submittedAtContestMs,
      wrongAttempts,
      penaltyMinutes,
    }),
    canonical,
  };
}

function expectedAggregate(states) {
  const solved = states.filter((state) => state.solved);
  return {
    solvedCount: solved.length,
    totalPenalty: solved.reduce((sum, state) => sum + state.problemPenalty, 0),
    lastAcceptedContestMs:
      solved.length === 0
        ? null
        : solved.reduce(
            (max, state) => Math.max(max, state.firstAcceptedAtContestMs),
            0,
          ),
  };
}

function expectedLedgerEffect(submission, canonical) {
  if (isSolvingVerdict(submission.verdict)) {
    return canonical && idsEqual(canonical._id, submission._id)
      ? SCORING_EFFECT.SOLVE
      : SCORING_EFFECT.IGNORED_NONCANONICAL_AC;
  }
  if (isWrongAttemptVerdict(submission.verdict)) {
    return canonical &&
      submission.submittedAtContestMs >= canonical.submittedAtContestMs
      ? SCORING_EFFECT.IGNORED_POST_SOLVE
      : SCORING_EFFECT.WRONG;
  }
  return SCORING_EFFECT.NONE;
}

function sameProblemState(actual, expected) {
  if (!actual && !expected.solved) {
    return true;
  }
  return Boolean(
    actual &&
      actual.solved === expected.solved &&
      idsEqual(actual.firstAcceptedSubmissionId, expected.firstAcceptedSubmissionId) &&
      actual.firstAcceptedAtContestMs === expected.firstAcceptedAtContestMs &&
      actual.problemPenalty === expected.problemPenalty,
  );
}

function sameAggregate(actual, expected) {
  return Boolean(
    actual &&
      actual.solvedCount === expected.solvedCount &&
      actual.totalPenalty === expected.totalPenalty &&
      actual.lastAcceptedContestMs === expected.lastAcceptedContestMs,
  );
}

function problemWriteState(expected) {
  return {
    solved: expected.solved,
    firstAcceptedSubmissionId: expected.firstAcceptedSubmissionId,
    firstAcceptedAtContestMs: expected.firstAcceptedAtContestMs,
    problemPenalty: expected.problemPenalty,
  };
}

async function assertAdmin(actorUserId) {
  if (!actorUserId) {
    throw new Error("actorUserId is required for mutating reconciliation");
  }
  const actor = await User.findById(actorUserId).select("role").lean();
  if (!actor || actor.role !== "admin") {
    throw new Error("Only admins may mutate scoring reconciliation");
  }
}

async function reconcileLedger(submission, canonical, options, report) {
  const expectedEffect = expectedLedgerEffect(submission, canonical);
  const existing = await ScoringRepository.findLedgerEntry(submission._id);
  if (existing) {
    const identityMatches =
      idsEqual(existing.contestId, submission.contestId) &&
      idsEqual(existing.userId, submission.userId) &&
      idsEqual(existing.contestProblemId, submission.contestProblemId) &&
      existing.verdict === submission.verdict &&
      existing.submittedAtContestMs === submission.submittedAtContestMs;
    if (!identityMatches) {
      report.invalidLedgerIdentityCount += 1;
      report.invalidLedgerSubmissionIds.push(String(submission._id));
      report.incomplete = true;
      return;
    }
    if (existing.effect !== expectedEffect) {
      report.ledgerEffectCorrections += 1;
      if (!options.dryRun) {
        await ScoringRepository.updateLedgerEffect(submission._id, expectedEffect);
      }
    }
    return;
  }

  report.missingLedgerCount += 1;
  if (options.dryRun) {
    return;
  }
  try {
    await ScoringRepository.createLedgerEntry({
      submissionId: submission._id,
      contestId: submission.contestId,
      userId: submission.userId,
      contestProblemId: submission.contestProblemId,
      verdict: submission.verdict,
      submittedAtContestMs: submission.submittedAtContestMs,
      effect: expectedEffect,
    });
  } catch (error) {
    if (!duplicateKey(error)) {
      throw error;
    }
    report.concurrentLedgerDuplicates += 1;
  }
}

async function reconcileParticipantInternal({
  contest,
  userId,
  options,
  report,
}) {
  const contestProblemMap = new Map(
    contest.problems.map((problem) => [String(problem._id), problem]),
  );
  const existingStates = await ScoringRepository.findParticipantProblems(contest._id, userId);
  const existingStateMap = new Map(
    existingStates.map((state) => [String(state.contestProblemId), state]),
  );
  const seenProblemIds = new Set();
  const expectedStateMap = new Map();
  const cursor = SubmissionRepository.findCompletedContestCursor({
    contestId: contest._id,
    userId,
    batchSize: options.batchSize,
  });

  let currentKey = null;
  let currentSubmissions = [];
  async function flushGroup() {
    if (!currentKey) {
      return;
    }
    const problem = contestProblemMap.get(currentKey.split("|")[1]);
    if (!problem) {
      return;
    }
    const expected = expectedProblemState(currentSubmissions, problem.penaltyMinutes);
    const actual = existingStateMap.get(currentKey.split("|")[1]);
    seenProblemIds.add(currentKey.split("|")[1]);
    expectedStateMap.set(currentKey.split("|")[1], expected);
    if (!sameProblemState(actual, expected)) {
      report.problemRepairs += 1;
      if (expected.solved || actual) {
        if (!options.dryRun) {
          await ScoringRepository.upsertProblemState({
            contestId: contest._id,
            userId,
            contestProblemId: problem._id,
            state: problemWriteState(expected),
          });
        }
      }
    }
    for (const submission of currentSubmissions) {
      await reconcileLedger(submission, expected.canonical, options, report);
    }
    currentSubmissions = [];
  }

  try {
    for await (const submission of cursor) {
      const invalidReason = sourceIsValid(submission, contestProblemMap);
      if (invalidReason) {
        report.invalidSourceCount += 1;
        report.invalidSourceSubmissionIds.push(String(submission._id));
        report.invalidSourceReasons.push({
          submissionId: String(submission._id),
          reason: invalidReason,
        });
        report.incomplete = true;
        continue;
      }
      const key = `${submission.userId}|${submission.contestProblemId}`;
      if (currentKey !== key) {
        await flushGroup();
        currentKey = key;
      }
      currentSubmissions.push(submission);
    }
    await flushGroup();
  } finally {
    await cursor.close();
  }

  const allProblemIds = new Set(contestProblemMap.keys());
  const statesForAggregate = [];

  for (const problem of contest.problems) {
    const problemId = String(problem._id);
    const actual = existingStateMap.get(problemId);
    const expected = seenProblemIds.has(problemId)
      ? expectedStateMap.get(problemId)
      : expectedProblemState([], problem.penaltyMinutes);
    statesForAggregate.push(expected);

    if (!sameProblemState(actual, expected)) {
      report.problemRepairs += 1;
      if (expected.solved || actual) {
        if (!options.dryRun) {
          await ScoringRepository.upsertProblemState({
            contestId: contest._id,
            userId,
            contestProblemId: problem._id,
            state: problemWriteState(expected),
          });
        }
      }
    }

  }

  for (const existing of existingStates) {
    if (!allProblemIds.has(String(existing.contestProblemId))) {
      report.orphanedProblemStateCount += 1;
      if (!options.dryRun) {
        await ScoringRepository.deleteProblemState(
          contest._id,
          userId,
          existing.contestProblemId,
        );
      }
    }
  }

  const aggregate = expectedAggregate(statesForAggregate);
  const actualAggregate = await ScoringRepository.findParticipantAggregate(contest._id, userId);
  if (!actualAggregate) {
    report.missingParticipantCount += 1;
    return;
  }
  if (!sameAggregate(actualAggregate, aggregate)) {
    report.aggregateRepairs += 1;
    if (!options.dryRun) {
      await ScoringRepository.updateParticipantAggregate(contest._id, userId, aggregate);
    }
  }
}

async function reconcileParticipantScoring(contestId, userId, options = {}) {
  const contest = await ScoringRepository.findContestById(contestId);
  if (!contest) {
    throw new Error("Contest not found");
  }
  if (![...MUTABLE_CONTEST_STATUSES, AUDIT_ONLY_CONTEST_STATUS].includes(contest.status)) {
    throw new Error(`Contest status ${contest.status} is not eligible for reconciliation`);
  }
  const participant = await ScoringRepository.findParticipant(contestId, userId);
  if (!participant) {
    throw new Error("Participant not registered for this contest");
  }

  const dryRun = options.dryRun === true;
  if (contest.status === AUDIT_ONLY_CONTEST_STATUS && !dryRun) {
    throw new Error("FINALIZED contest reconciliation is audit-only");
  }
  if (!dryRun) {
    await assertAdmin(options.actorUserId);
    if (!nonEmptyReason(options.recoveryReason)) {
      throw new Error("A non-empty recoveryReason is required for mutation");
    }
  }

  const report = createReport({ contestId, userId, dryRun, status: contest.status });
  const maxPasses = Math.max(1, options.maxPasses || DEFAULT_MAX_PASSES);
  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const before = await SubmissionRepository.getContestSourceFingerprint(contestId, userId);
    try {
      await reconcileParticipantInternal({
        contest,
        userId,
        options: { ...options, dryRun, batchSize: options.batchSize || DEFAULT_BATCH_SIZE },
        report,
      });
    } catch (error) {
      report.partialFailure = true;
      report.incomplete = true;
      report.errors.push(error.message);
    }
    const after = await SubmissionRepository.getContestSourceFingerprint(contestId, userId);
    report.passes = pass;
    if (JSON.stringify(before) === JSON.stringify(after)) {
      break;
    }
    report.converged = false;
    report.unstable = true;
    report.incomplete = true;
  }
  report.completed = !report.partialFailure && !report.unstable;
  return report;
}

function createReport(fields) {
  return {
    ...fields,
    completed: false,
    converged: true,
    unstable: false,
    incomplete: false,
    invalidSourceCount: 0,
    invalidSourceSubmissionIds: [],
    invalidSourceReasons: [],
    invalidLedgerIdentityCount: 0,
    invalidLedgerSubmissionIds: [],
    missingLedgerCount: 0,
    concurrentLedgerDuplicates: 0,
    ledgerEffectCorrections: 0,
    problemRepairs: 0,
    aggregateRepairs: 0,
    orphanedProblemStateCount: 0,
    missingParticipantCount: 0,
    partialFailure: false,
    errors: [],
    passes: 0,
  };
}

async function reconcileContestScoring(contestId, options = {}) {
  const contest = await ScoringRepository.findContestById(contestId);
  if (!contest) {
    throw new Error("Contest not found");
  }
  if (![...MUTABLE_CONTEST_STATUSES, AUDIT_ONLY_CONTEST_STATUS].includes(contest.status)) {
    throw new Error(`Contest status ${contest.status} is not eligible for reconciliation`);
  }

  const dryRun = options.dryRun === true;
  if (contest.status === AUDIT_ONLY_CONTEST_STATUS && !dryRun) {
    throw new Error("FINALIZED contest reconciliation is audit-only");
  }
  if (!dryRun) {
    await assertAdmin(options.actorUserId);
    if (!nonEmptyReason(options.recoveryReason)) {
      throw new Error("A non-empty recoveryReason is required for mutation");
    }
  }

  const report = createReport({ contestId, dryRun, status: contest.status });
  const maxPasses = Math.max(1, options.maxPasses || DEFAULT_MAX_PASSES);
  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const before = await SubmissionRepository.getContestSourceFingerprint(contestId);
    const participantCursor = ScoringRepository.findParticipantsCursor(
      contestId,
      options.batchSize || DEFAULT_BATCH_SIZE,
    );
    try {
      for await (const participant of participantCursor) {
        try {
          await reconcileParticipantInternal({
            contest,
            userId: participant.userId,
            options: { ...options, dryRun, batchSize: options.batchSize || DEFAULT_BATCH_SIZE },
            report,
          });
        } catch (error) {
          report.partialFailure = true;
          report.incomplete = true;
          report.errors.push({ userId: String(participant.userId), message: error.message });
        }
      }
    } finally {
      await participantCursor.close();
    }
    const after = await SubmissionRepository.getContestSourceFingerprint(contestId);
    report.passes = pass;
    if (JSON.stringify(before) === JSON.stringify(after)) {
      break;
    }
    report.converged = false;
    report.unstable = true;
    report.incomplete = true;
  }

  if (report.unstable || report.partialFailure) {
    report.completed = false;
    report.partialFailure = true;
  } else {
    report.completed = true;
  }
  return report;
}

module.exports = {
  reconcileContestScoring,
  reconcileParticipantScoring,
};
