const Submission = require("../models/Submission");
const Contest = require("../models/Contest");
const ContestParticipant = require("../models/ContestParticipant");
const ContestParticipantProblem = require("../models/ContestParticipantProblem");
const ContestScoredSubmission = require("../models/ContestScoredSubmission");
const { SUBMISSION_STATUS } = require("../contracts/verdicts");
const {
  SCORING_EFFECT,
  isTerminalForScoring,
  isWrongAttemptVerdict,
  isSolvingVerdict,
  pickCanonicalAcceptedSubmission,
  countWrongAttemptsBeforeSolve,
  calculateProblemPenalty,
  compareCanonicalSubmissionOrder,
} = require("../contracts/scoring");

const CONTEST_SCORING_ELIGIBLE_STATUSES = new Set(["RUNNING", "ENDED"]);

function isDuplicateKeyError(error) {
  return Boolean(error && (error.code === 11000 || error.code === 11001));
}

function toPlainSubmission(submission) {
  if (!submission) {
    return null;
  }
  return submission.toObject ? submission.toObject() : submission;
}

async function loadTerminalSubmission(submissionId, submissionOverride = null) {
  if (submissionOverride) {
    return toPlainSubmission(submissionOverride);
  }
  return Submission.findById(submissionId).lean();
}

async function insertScoringLedger(submission, effect) {
  try {
    const ledgerEntry = await ContestScoredSubmission.create({
      submissionId: submission._id,
      contestId: submission.contestId,
      userId: submission.userId,
      contestProblemId: submission.contestProblemId,
      verdict: submission.verdict,
      submittedAtContestMs: submission.submittedAtContestMs,
      effect,
    });
    return { created: true, ledgerEntry };
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    const existing = await ContestScoredSubmission.findOne({ submissionId: submission._id }).lean();
    return { created: false, ledgerEntry: existing };
  }
}

async function updateLedgerEffect(submissionId, effect) {
  await ContestScoredSubmission.updateOne({ submissionId }, { $set: { effect } });
}

async function loadScopedSubmissions({ contestId, userId, contestProblemId }) {
  return Submission.find({
    contestId,
    userId,
    contestProblemId,
    status: SUBMISSION_STATUS.COMPLETED,
  }).lean();
}

function getContestProblem(contest, contestProblemId) {
  if (!contest || !Array.isArray(contest.problems)) {
    return null;
  }
  return (
    contest.problems.find((problem) => String(problem._id) === String(contestProblemId)) || null
  );
}

async function reconcileParticipantAggregate({ contestId, userId }) {
  const solvedProblems = await ContestParticipantProblem.find({
    contestId,
    userId,
    solved: true,
  })
    .select("problemPenalty firstAcceptedAtContestMs")
    .lean();

  const solvedCount = solvedProblems.length;
  const totalPenalty = solvedProblems.reduce(
    (sum, problem) => sum + (problem.problemPenalty || 0),
    0,
  );
  const lastAcceptedContestMs =
    solvedProblems.length === 0
      ? null
      : solvedProblems.reduce((max, problem) => {
          const value = problem.firstAcceptedAtContestMs ?? 0;
          return value > max ? value : max;
        }, 0);

  await ContestParticipant.updateOne(
    { contestId, userId },
    {
      $set: {
        solvedCount,
        totalPenalty,
        lastAcceptedContestMs,
      },
    },
  );

  return { solvedCount, totalPenalty, lastAcceptedContestMs };
}

async function ensureProblemSolvedFromCanonical({
  canonical,
  scopedSubmissions,
  penaltyMinutes,
  contestId,
  userId,
  contestProblemId,
}) {
  const canonicalId = canonical._id;
  const canonicalMs = canonical.submittedAtContestMs;
  const wrongAttempts = countWrongAttemptsBeforeSolve(scopedSubmissions, canonicalMs);
  const problemPenalty = calculateProblemPenalty({
    firstAcceptedAtContestMs: canonicalMs,
    wrongAttempts,
    penaltyMinutes,
  });

  const prior = await ContestParticipantProblem.findOne({
    contestId,
    userId,
    contestProblemId,
  });

  if (
    prior &&
    prior.solved &&
    String(prior.firstAcceptedSubmissionId) === String(canonicalId) &&
    prior.problemPenalty === problemPenalty &&
    prior.firstAcceptedAtContestMs === canonicalMs
  ) {
    return { newlySolved: false, corrected: false, alreadyCorrect: true };
  }

  if (prior && prior.solved) {
    await ContestParticipantProblem.updateOne(
      { contestId, userId, contestProblemId },
      {
        $set: {
          firstAcceptedSubmissionId: canonicalId,
          firstAcceptedAtContestMs: canonicalMs,
          problemPenalty,
          solved: true,
        },
      },
    );

    return { newlySolved: false, corrected: true, alreadyCorrect: false };
  }

  let updated;
  try {
    updated = await ContestParticipantProblem.findOneAndUpdate(
      {
        contestId,
        userId,
        contestProblemId,
        solved: false,
      },
      {
        $set: {
          solved: true,
          firstAcceptedSubmissionId: canonicalId,
          firstAcceptedAtContestMs: canonicalMs,
          problemPenalty,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    updated = null;
  }

  if (!updated) {
    const existing = await ContestParticipantProblem.findOne({
      contestId,
      userId,
      contestProblemId,
    });

    if (existing && existing.solved) {
      const canonicalIsEarlier =
        compareCanonicalSubmissionOrder(canonical, {
          _id: existing.firstAcceptedSubmissionId,
          submittedAtContestMs: existing.firstAcceptedAtContestMs,
        }) < 0;

      if (canonicalIsEarlier) {
        return ensureProblemSolvedFromCanonical({
          canonical,
          scopedSubmissions,
          penaltyMinutes,
          contestId,
          userId,
          contestProblemId,
        });
      }

      return { newlySolved: false, corrected: false, alreadyCorrect: true };
    }

    throw new Error("Failed to apply canonical contest solve state");
  }

  if (String(updated.firstAcceptedSubmissionId) !== String(canonicalId)) {
    return { newlySolved: false, corrected: false, alreadyCorrect: true };
  }

  const wasUnsolved = !(prior && prior.solved);
  if (wasUnsolved) {
    return { newlySolved: true, corrected: false, alreadyCorrect: false };
  }

  return { newlySolved: false, corrected: false, alreadyCorrect: false };
}

function resolveLedgerEffect({
  submission,
  canonical,
  priorProblemSolved,
  solveResult,
}) {
  if (isSolvingVerdict(submission.verdict)) {
    if (!canonical || String(canonical._id) !== String(submission._id)) {
      return SCORING_EFFECT.IGNORED_NONCANONICAL_AC;
    }
    if (solveResult.newlySolved || solveResult.corrected) {
      return SCORING_EFFECT.SOLVE;
    }
    return SCORING_EFFECT.NONE;
  }

  if (priorProblemSolved && !solveResult.newlySolved && !solveResult.corrected) {
    return SCORING_EFFECT.IGNORED_POST_SOLVE;
  }

  if (isWrongAttemptVerdict(submission.verdict)) {
    return SCORING_EFFECT.WRONG;
  }

  return SCORING_EFFECT.NONE;
}

async function applySubmissionResult(submissionId, options = {}) {
  const submission = await loadTerminalSubmission(submissionId, options.submission);

  if (!submission) {
    return { processed: false, reason: "submission_not_found" };
  }

  if (!submission.contestId) {
    return { processed: false, reason: "practice_submission" };
  }

  if (!isTerminalForScoring(submission.status)) {
    return { processed: false, reason: "submission_not_terminal" };
  }

  if (submission.submittedAtContestMs == null) {
    return { processed: false, reason: "missing_submitted_at_contest_ms" };
  }

  if (!submission.contestProblemId) {
    return { processed: false, reason: "missing_contest_problem_id" };
  }

  const contest = await Contest.findById(submission.contestId).lean();
  if (!contest) {
    return { processed: false, reason: "contest_not_found" };
  }

  if (!CONTEST_SCORING_ELIGIBLE_STATUSES.has(contest.status)) {
    return { processed: false, reason: "contest_not_eligible", contestStatus: contest.status };
  }

  const participant = await ContestParticipant.findOne({
    contestId: submission.contestId,
    userId: submission.userId,
  }).lean();

  if (!participant) {
    return { processed: false, reason: "participant_not_registered" };
  }

  const contestProblem = getContestProblem(contest, submission.contestProblemId);
  if (!contestProblem) {
    return { processed: false, reason: "invalid_contest_problem" };
  }

  const scopedSubmissions = await loadScopedSubmissions({
    contestId: submission.contestId,
    userId: submission.userId,
    contestProblemId: submission.contestProblemId,
  });

  const canonical = pickCanonicalAcceptedSubmission(scopedSubmissions);
  const priorProblem = await ContestParticipantProblem.findOne({
    contestId: submission.contestId,
    userId: submission.userId,
    contestProblemId: submission.contestProblemId,
  }).lean();

  const priorProblemSolved = Boolean(priorProblem && priorProblem.solved);

  let solveResult = {
    newlySolved: false,
    corrected: false,
    alreadyCorrect: priorProblemSolved,
  };

  if (canonical) {
    solveResult = await ensureProblemSolvedFromCanonical({
      canonical,
      scopedSubmissions,
      penaltyMinutes: contestProblem.penaltyMinutes,
      contestId: submission.contestId,
      userId: submission.userId,
      contestProblemId: submission.contestProblemId,
    });
  }

  await reconcileParticipantAggregate({
    contestId: submission.contestId,
    userId: submission.userId,
  });

  const effect = resolveLedgerEffect({
    submission,
    canonical,
    priorProblemSolved,
    solveResult,
  });

  const { created: ledgerCreated } = await insertScoringLedger(submission, effect);
  if (ledgerCreated) {
    return {
      processed: true,
      effect,
      ledgerCreated: true,
      solveResult,
    };
  }

  await updateLedgerEffect(submission._id, effect);

  return {
    processed: true,
    effect,
    ledgerCreated: false,
    solveResult,
  };
}

module.exports = {
  CONTEST_SCORING_ELIGIBLE_STATUSES,
  applySubmissionResult,
  reconcileParticipantAggregate,
  isDuplicateKeyError,
};
