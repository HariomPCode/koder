const { JUDGE_VERDICTS, SUBMISSION_STATUS } = require("./verdicts");

const MS_PER_CONTEST_MINUTE = 60 * 1000;

/**
 * Terminal non-Accepted verdicts that count as wrong attempts before first solve.
 */
const WRONG_ATTEMPT_VERDICTS = Object.freeze(
  new Set([
    JUDGE_VERDICTS.WRONG_ANSWER,
    JUDGE_VERDICTS.COMPILATION_ERROR,
    JUDGE_VERDICTS.RUNTIME_ERROR,
    JUDGE_VERDICTS.TIME_LIMIT_EXCEEDED,
    JUDGE_VERDICTS.MEMORY_LIMIT_EXCEEDED,
  ]),
);

const SOLVING_VERDICT = JUDGE_VERDICTS.ACCEPTED;

const TERMINAL_SCORING_STATUS = SUBMISSION_STATUS.COMPLETED;

const SCORING_EFFECT = Object.freeze({
  NONE: "none",
  WRONG: "wrong",
  SOLVE: "solve",
  IGNORED_POST_SOLVE: "ignored-post-solve",
  IGNORED_NONCANONICAL_AC: "ignored-noncanonical-ac",
});

function isTerminalForScoring(status) {
  return status === TERMINAL_SCORING_STATUS;
}

function isWrongAttemptVerdict(verdict) {
  return WRONG_ATTEMPT_VERDICTS.has(verdict);
}

function isSolvingVerdict(verdict) {
  return verdict === SOLVING_VERDICT;
}

function msToSolveMinutes(submittedAtContestMs) {
  if (submittedAtContestMs == null || submittedAtContestMs < 0) {
    return 0;
  }
  return Math.floor(submittedAtContestMs / MS_PER_CONTEST_MINUTE);
}

/**
 * ICPC problem penalty:
 * floor(firstAcceptedAtContestMs / 60000) + wrongAttempts × penaltyMinutes
 */
function calculateProblemPenalty({ firstAcceptedAtContestMs, wrongAttempts = 0, penaltyMinutes = 0 }) {
  const solveMinutes = msToSolveMinutes(firstAcceptedAtContestMs);
  const wrongCount = Math.max(0, wrongAttempts);
  const perWrongPenalty = Math.max(0, penaltyMinutes);
  return solveMinutes + wrongCount * perWrongPenalty;
}

function normalizeId(value) {
  return String(value);
}

/**
 * Canonical Accepted ordering: submittedAtContestMs ASC, submissionId ASC.
 * Returns negative if `a` should rank before `b` (earlier canonical AC).
 */
function compareCanonicalSubmissionOrder(a, b) {
  const aMs = a.submittedAtContestMs ?? 0;
  const bMs = b.submittedAtContestMs ?? 0;
  if (aMs !== bMs) {
    return aMs - bMs;
  }

  const aId = normalizeId(a._id ?? a.submissionId ?? a.id);
  const bId = normalizeId(b._id ?? b.submissionId ?? b.id);
  return aId.localeCompare(bId);
}

function pickCanonicalAcceptedSubmission(submissions) {
  if (!Array.isArray(submissions) || submissions.length === 0) {
    return null;
  }

  const accepted = submissions.filter(
    (submission) =>
      isTerminalForScoring(submission.status) && isSolvingVerdict(submission.verdict),
  );

  if (accepted.length === 0) {
    return null;
  }

  return [...accepted].sort(compareCanonicalSubmissionOrder)[0];
}

function countWrongAttemptsBeforeSolve(submissions, solveAtContestMs) {
  if (!Array.isArray(submissions)) {
    return 0;
  }

  return submissions.filter(
    (submission) =>
      isTerminalForScoring(submission.status) &&
      isWrongAttemptVerdict(submission.verdict) &&
      (submission.submittedAtContestMs ?? Number.POSITIVE_INFINITY) < solveAtContestMs,
  ).length;
}

/**
 * Standings tie-break (best rank first when sorting ascending by this comparator):
 * 1. solvedCount DESC
 * 2. totalPenalty ASC
 * 3. lastAcceptedContestMs ASC
 * 4. userId ASC
 *
 * Returns negative if `a` outranks `b`.
 */
function compareParticipantStandings(a, b) {
  const aSolved = a.solvedCount ?? 0;
  const bSolved = b.solvedCount ?? 0;
  if (aSolved !== bSolved) {
    return bSolved - aSolved;
  }

  const aPenalty = a.totalPenalty ?? 0;
  const bPenalty = b.totalPenalty ?? 0;
  if (aPenalty !== bPenalty) {
    return aPenalty - bPenalty;
  }

  const aLast = a.lastAcceptedContestMs ?? Number.POSITIVE_INFINITY;
  const bLast = b.lastAcceptedContestMs ?? Number.POSITIVE_INFINITY;
  if (aLast !== bLast) {
    return aLast - bLast;
  }

  return normalizeId(a.userId).localeCompare(normalizeId(b.userId));
}

/**
 * Assign competition ranks (1, 2, 2, 4) using compareParticipantStandings.
 */
function assignCompetitionRanks(participants) {
  const sorted = [...participants].sort(compareParticipantStandings);
  const ranked = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const entry = sorted[index];
    if (index > 0 && compareParticipantStandings(entry, sorted[index - 1]) === 0) {
      ranked.push({ ...entry, rank: ranked[index - 1].rank });
    } else {
      ranked.push({ ...entry, rank: index + 1 });
    }
  }

  return ranked;
}

module.exports = {
  MS_PER_CONTEST_MINUTE,
  WRONG_ATTEMPT_VERDICTS,
  SOLVING_VERDICT,
  TERMINAL_SCORING_STATUS,
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
};
