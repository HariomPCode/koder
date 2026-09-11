const {
  Contest,
  ContestParticipant,
  Question,
  Submission,
  ContestLeaderboardSnapshot,
  ContestFinalizationAudit,
  assignCompetitionRanks,
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  SUBMISSION_STATUS,
  normalizeObjectId,
} = require("@koder/shared");
const ContestRepository = require("../repositories/contest.repository");
const AppError = require("../errors/appError");
const queue = require("../queue");
const { validateSubmissionPayload } = require("../validators/request.validators");
const ScoringReconcileService = require("./scoring-reconcile.service");
const standingsService = require("./standings.service");
const { createSubmissionIdempotency } = require("./submissionIdempotency");
const {
  CONTEST_STATUS,
  getNextContestLifecycleStatus,
  normalizeContestStatus,
} = require("./contestLifecycle");
const { formatStanding, paginationResult } = standingsService;
const { parsePagination, paginationResult: buildPaginationResult } = require("../utils/pagination");
const { createLogger } = require("@koder/shared");
const logger = createLogger("backend.contest");
const eventBus = require("../events/eventBus");
let contestLeaderboardLifecycle = null;

function getContestLeaderboardLifecycle() {
  if (!contestLeaderboardLifecycle) {
    contestLeaderboardLifecycle = require("./contestLeaderboardLifecycle").createContestLeaderboardLifecycle();
  }
  return contestLeaderboardLifecycle;
}

const VALID_TRANSITIONS = Object.freeze({
  [CONTEST_STATUS.DRAFT]: [CONTEST_STATUS.SCHEDULED],
  [CONTEST_STATUS.SCHEDULED]: [CONTEST_STATUS.REGISTRATION],
  [CONTEST_STATUS.REGISTRATION]: [CONTEST_STATUS.RUNNING],
  [CONTEST_STATUS.RUNNING]: [CONTEST_STATUS.ENDED],
  [CONTEST_STATUS.ENDED]: [CONTEST_STATUS.FINALIZED],
  [CONTEST_STATUS.FINALIZED]: [],
});

function assertContestTransition(currentStatus, nextStatus) {
  const normalizedCurrent = normalizeContestStatus(currentStatus);
  const normalizedNext = normalizeContestStatus(nextStatus);

  if (!normalizedCurrent || !normalizedNext) {
    throw AppError.validation("Contest status is required");
  }

  if (normalizedCurrent === normalizedNext) {
    return;
  }

  const allowed = VALID_TRANSITIONS[normalizedCurrent] || [];
  if (!allowed.includes(normalizedNext)) {
    throw AppError.badRequest(
      `Invalid contest status transition from ${normalizedCurrent} to ${normalizedNext}`,
    );
  }
}

async function syncContestLifecycle(contest) {
  if (!contest) {
    return contest;
  }

  const nextStatus = getNextContestLifecycleStatus(contest);

  if (nextStatus !== contest.status) {
    contest.status = nextStatus;
    await contest.save();
    if (nextStatus === CONTEST_STATUS.RUNNING) {
      await getContestLeaderboardLifecycle().preseedContest(contest._id);
    }
    eventBus.emit("contest.lifecycle", {
      contestId: String(contest._id),
      status: nextStatus,
    });
  }

  return contest;
}

async function getContestById({ contestId, userId = null }) {
  const contest = await ContestRepository.findById(contestId);

  if (!contest) {
    throw AppError.notFound("Contest not found");
  }

  const currentContest = await syncContestLifecycle(contest);
  const participant = userId ? await ContestRepository.findParticipant(contestId, userId) : null;

  return {
    contest: currentContest.toObject ? currentContest.toObject() : currentContest,
    registered: Boolean(participant),
  };
}

async function listContests({ page, limit } = {}) {
  const pagination = parsePagination({ page, limit }, { defaultLimit: 20 });
  const [contests, total] = await Promise.all([
    ContestRepository.findAll(pagination),
    ContestRepository.countAll(),
  ]);
  return {
    contests,
    pagination: buildPaginationResult({ ...pagination, total }),
  };
}

async function createContest({ createdBy, payload }) {
  const contestData = { ...payload };

  if (!contestData.title || !String(contestData.title).trim()) {
    throw AppError.validation("Contest title is required");
  }

  contestData.title = String(contestData.title).trim();

  if (!contestData.slug) {
    contestData.slug = contestData.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }

  contestData.slug = String(contestData.slug).trim().toLowerCase();
  contestData.createdBy = createdBy;
  contestData.status = normalizeContestStatus(contestData.status || CONTEST_STATUS.DRAFT);

  if (!contestData.registrationOpenTime || !contestData.startTime || !contestData.endTime) {
    throw AppError.validation("registrationOpenTime, startTime, and endTime are required");
  }

  if (contestData.problems === undefined) {
    contestData.problems = [];
  }

  const contest = await Contest.create(contestData);
  return { contest };
}

async function transitionContestStatus({ contestId, targetStatus, actorUserId }) {
  const contest = await ContestRepository.findById(contestId);
  if (!contest) {
    throw AppError.notFound("Contest not found");
  }

  const actor = await require("../models/User").findById(actorUserId);
  if (!actor || actor.role !== "admin") {
    throw AppError.forbidden("Only admins may manage contest lifecycle");
  }

  const normalizedTarget = normalizeContestStatus(targetStatus);
  const currentStatus = normalizeContestStatus(contest.status);

  if (normalizedTarget === currentStatus) {
    return { contest };
  }

  assertContestTransition(currentStatus, normalizedTarget);

  if (normalizedTarget === CONTEST_STATUS.REGISTRATION && contest.registrationOpenTime) {
    const now = Date.now();
    if (new Date(contest.registrationOpenTime).getTime() > now) {
      throw AppError.badRequest("Registration cannot open before registrationOpenTime");
    }
  }

  if (normalizedTarget === CONTEST_STATUS.RUNNING && contest.startTime) {
    const now = Date.now();
    if (new Date(contest.startTime).getTime() > now) {
      throw AppError.badRequest("Contest cannot start before startTime");
    }
  }

  if (normalizedTarget === CONTEST_STATUS.ENDED && contest.endTime) {
    const now = Date.now();
    if (new Date(contest.endTime).getTime() > now) {
      throw AppError.badRequest("Contest cannot end before endTime");
    }
  }

  if (normalizedTarget === CONTEST_STATUS.FINALIZED) {
    return finalizeContest({ contestId, actorUserId });
  }

  contest.status = normalizedTarget;
  await contest.save();
  if (normalizedTarget === CONTEST_STATUS.RUNNING) {
    await getContestLeaderboardLifecycle().preseedContest(contest._id);
  }
  eventBus.emit("contest.lifecycle", {
    contestId: String(contest._id),
    status: normalizedTarget,
  });
  return { contest };
}

async function updateContest({ contestId, actorUserId, payload }) {
  const contest = await ContestRepository.findById(contestId);
  if (!contest) {
    throw AppError.notFound("Contest not found");
  }

  const actor = await require("../models/User").findById(actorUserId);
  if (!actor || actor.role !== "admin") {
    throw AppError.forbidden("Only admins may update contests");
  }

  if (payload.status) {
    const nextStatus = normalizeContestStatus(payload.status);
    if (nextStatus !== normalizeContestStatus(contest.status)) {
      throw AppError.badRequest("Contest status must be changed via explicit lifecycle transition APIs");
    }
  }

  if ([CONTEST_STATUS.RUNNING, CONTEST_STATUS.ENDED, CONTEST_STATUS.FINALIZED].includes(normalizeContestStatus(contest.status))) {
    const immutableFields = ["registrationOpenTime", "startTime", "endTime", "problems", "slug"];
    const attempted = immutableFields.filter((field) => Object.prototype.hasOwnProperty.call(payload, field));
    if (attempted.length > 0) {
      throw AppError.badRequest(`Contest ${attempted.join(", ")} is immutable after contest start`);
    }
  }

  const nextContest = await ContestRepository.findByIdAndUpdate(contestId, payload, { runValidators: true });
  return { contest: nextContest };
}

async function registerParticipant({ contestId, userId }) {
  const contest = await ContestRepository.findById(contestId);
  if (!contest) {
    throw AppError.notFound("Contest not found");
  }

  const currentContest = await syncContestLifecycle(contest);

  if (currentContest.status !== CONTEST_STATUS.REGISTRATION) {
    throw AppError.badRequest("Registration is closed for this contest");
  }

  const existing = await ContestRepository.findParticipant(contestId, userId);
  if (existing) {
    return { registered: true, participant: existing };
  }

  const participant = await ContestRepository.createParticipant({ contestId, userId, registeredAt: new Date() });
  return { registered: true, participant };
}

async function unregisterParticipant({ contestId, userId }) {
  const contest = await ContestRepository.findById(contestId);
  if (!contest) {
    throw AppError.notFound("Contest not found");
  }

  const deleted = await ContestRepository.deleteParticipant(contestId, userId);
  if (deleted.deletedCount === 0) {
    throw AppError.notFound("Participant not registered for this contest");
  }

  return { removed: true };
}

async function getContestProblems({ contestId, userId = null }) {
  const contest = await ContestRepository.findById(contestId);
  if (!contest) {
    throw AppError.notFound("Contest not found");
  }

  const currentContest = await syncContestLifecycle(contest);

  const problemIds = currentContest.problems.map((problem) => problem.questionId);
  const [participant, questions] = await Promise.all([
    userId ? ContestRepository.findParticipant(contestId, userId) : Promise.resolve(null),
    Question.find({ _id: { $in: problemIds } }).lean(),
  ]);
  if (userId && !participant && currentContest.status !== CONTEST_STATUS.ENDED && currentContest.status !== CONTEST_STATUS.FINALIZED) {
    throw AppError.forbidden("You must register before viewing contest problems");
  }
  const questionMap = new Map(questions.map((question) => [String(question._id), question]));

  return {
    contest: currentContest.toObject ? currentContest.toObject() : currentContest,
    problems: currentContest.problems.map((problem) => ({
      ...problem.toObject ? problem.toObject() : problem,
      question: questionMap.get(String(problem.questionId)) || null,
    })),
  };
}

async function createContestSubmission({ contestId, userId, payload, idempotency = null }) {
  const contest = await ContestRepository.findById(contestId);
  if (!contest) {
    throw AppError.notFound("Contest not found");
  }

  const currentContest = await syncContestLifecycle(contest);

  if (currentContest.status !== CONTEST_STATUS.RUNNING) {
    throw AppError.badRequest("Contest is not currently running");
  }

  const participant = await ContestRepository.findParticipant(contestId, userId);
  if (!participant) {
    throw AppError.forbidden("You must register before submitting to this contest");
  }

  const normalizedPayload = payload || {};
  const contestProblemId = normalizedPayload.contestProblemId || normalizedPayload.problemId;
  if (!contestProblemId) {
    throw AppError.validation("contestProblemId is required");
  }

  const contestProblem = await ContestRepository.getContestProblem(currentContest, contestProblemId);
  if (!contestProblem) {
    throw AppError.badRequest("Invalid contest problem for this contest");
  }

  const normalizedLanguage = validateSubmissionPayload({
    language: normalizedPayload.language,
    code: normalizedPayload.code,
  });

  const now = Date.now();
  const contestStartedAt = new Date(currentContest.startTime).getTime();
  const submittedAtContestMs = Math.max(0, now - contestStartedAt);

  const question = await Question.findById(contestProblem.questionId);
  if (!question) {
    throw AppError.notFound("Question for contest problem not found");
  }

  const guard = idempotency || createSubmissionIdempotency({ redis: queue.connection });
  let reservation;
  try {
    reservation = await guard.reserve({
      userId,
      questionId: question._id,
      contestId: currentContest._id,
      contestProblemId: contestProblem._id,
      code: normalizedPayload.code,
    });
  } catch (error) {
    throw AppError.unavailable("Submission idempotency service unavailable");
  }

  if (reservation.type === "existing") {
    return {
      submissionId: reservation.submissionId,
      status: "processing",
    };
  }

  if (reservation.type === "in_progress") {
    throw AppError.conflict("An identical submission is already being processed");
  }

  let submission;
  try {
    submission = await ContestRepository.createSubmission({
      userId,
      questionId: question._id,
      contestId: currentContest._id,
      contestProblemId: contestProblem._id,
      submittedAtContestMs,
      code: normalizedPayload.code,
      language: normalizedLanguage,
      status: SUBMISSION_STATUS.CREATED,
    });
    eventBus.emit("submission.created", {
      submissionId: String(submission._id),
      userId: String(userId),
      questionId: String(question._id),
      contestId: String(currentContest._id),
    });

    await guard.publish({
      key: reservation.key,
      token: reservation.token,
      submissionId: submission._id,
    });
  } catch (error) {
    await guard.release(reservation).catch(() => {});
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.unavailable("Submission idempotency service unavailable");
  }

  try {
    await queue.enqueueSubmission({
      submissionId: submission._id,
      userId,
      questionId: question._id,
      language: normalizedLanguage,
      contestId: currentContest._id,
    });
    eventBus.emit("submission.queued", {
      submissionId: String(submission._id),
      userId: String(userId),
      questionId: String(question._id),
      contestId: String(currentContest._id),
    });
  } catch (error) {
    await Submission.findByIdAndUpdate(submission._id, { status: SUBMISSION_STATUS.CREATED }).catch(() => {});
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.unavailable("Queue unavailable while processing your submission");
  }

  await Submission.findByIdAndUpdate(submission._id, { status: SUBMISSION_STATUS.QUEUED }).catch(() => {});

  return { submissionId: submission._id, status: "processing" };
}

async function getContestSubmissions({
  contestId,
  userId = null,
  requesterUserId = null,
  page,
  limit,
}) {
  const contest = await ContestRepository.findById(contestId);
  if (!contest) {
    throw AppError.notFound("Contest not found");
  }

  if (requesterUserId && String(requesterUserId) !== String(userId) && requesterUserId !== userId) {
    // no-op: allowed to filter by their own submissions in the API layer
  }

  const pagination = parsePagination({ page, limit }, { defaultLimit: 50 });
  const [submissions, total] = await Promise.all([
    ContestRepository.listSubmissions(contestId, userId || null, pagination),
    ContestRepository.countSubmissions(contestId, userId || null),
  ]);
  return {
    submissions,
    pagination: buildPaginationResult({ ...pagination, total }),
  };
}

async function finalizeContest({ contestId, actorUserId, force = false, reason = "" }) {
  const contest = await ContestRepository.findById(contestId);
  if (!contest) {
    throw AppError.notFound("Contest not found");
  }

  const actor = await require("../models/User").findById(actorUserId);
  if (!actor || actor.role !== "admin") {
    throw AppError.forbidden("Only admins may finalize contests");
  }

  if (normalizeContestStatus(contest.status) === CONTEST_STATUS.FINALIZED) {
    const existingSnapshot = await ContestRepository.findFinalSnapshot(contestId);
    return {
      contest: contest.toObject ? contest.toObject() : contest,
      snapshot: existingSnapshot,
    };
  }

  const currentContest = await syncContestLifecycle(contest);

  if (normalizeContestStatus(currentContest.status) !== CONTEST_STATUS.ENDED) {
    throw AppError.badRequest("Contest must be ENDED before finalization");
  }

  const pendingStatuses = [
    SUBMISSION_STATUS.CREATED,
    SUBMISSION_STATUS.QUEUED,
    SUBMISSION_STATUS.PENDING,
    SUBMISSION_STATUS.RUNNING,
  ];

  const pendingSubmissions = await Submission.find({
    contestId: currentContest._id,
    status: { $in: pendingStatuses },
  }).lean();

  const hasPending = pendingSubmissions.length > 0;
  const isForced = force === true;

  if (hasPending && !isForced) {
    throw AppError.badRequest(
      `Cannot finalize contest: ${pendingSubmissions.length} pending submission(s) remain in queue or judging. Strict drain required, or use force=true with a reason.`,
    );
  }

  let auditRecord = null;
  const pendingSubmissionIds = pendingSubmissions.map((s) => s._id);

  if (isForced) {
    const trimmedReason = typeof reason === "string" ? reason.trim() : "";
    if (!trimmedReason) {
      throw AppError.badRequest("A non-empty reason is required for force-finalization");
    }

    auditRecord = await ContestRepository.createFinalizationAudit({
      contestId: currentContest._id,
      actorUserId: actor._id,
      forced: true,
      finalizedAt: new Date(),
      pendingSubmissionCount: pendingSubmissions.length,
      pendingSubmissionIds,
      reason: trimmedReason,
    });
  }

  // Pre-finalization scoring reconciliation
  const reconcileReport = await ScoringReconcileService.reconcileContestScoring(currentContest._id, {
    actorUserId: actor._id,
    dryRun: false,
    recoveryReason: isForced
      ? `Force-finalization reconciliation: ${typeof reason === "string" ? reason.trim() : ""}`
      : "Pre-finalization scoring reconciliation",
    excludeSubmissionIds: pendingSubmissionIds,
  });

  if (
    !reconcileReport ||
    !reconcileReport.converged ||
    !reconcileReport.completed ||
    reconcileReport.unstable ||
    reconcileReport.partialFailure
  ) {
    throw AppError.badRequest(
      "Finalization aborted: scoring reconciliation did not converge or encountered errors",
    );
  }

  // Build final standings snapshot
  const participants = await ContestParticipant.find({ contestId: currentContest._id }).lean();
  const rankedParticipants = assignCompetitionRanks(participants);

  const standings = rankedParticipants.map((p) => {
    const lastAcceptedAt =
      p.solvedCount > 0 && p.lastAcceptedContestMs != null
        ? new Date(new Date(currentContest.startTime).getTime() + p.lastAcceptedContestMs)
        : null;

    return {
      userId: p.userId,
      rank: p.rank,
      solvedCount: p.solvedCount || 0,
      score: p.solvedCount || 0,
      penalty: p.totalPenalty || 0,
      ...(lastAcceptedAt ? { lastAcceptedAt } : {}),
    };
  });

  const snapshotData = {
    contestId: currentContest._id,
    takenAt: new Date(),
    isFinal: true,
    standings,
  };

  let snapshot;
  try {
    snapshot = await ContestLeaderboardSnapshot.create(snapshotData);
  } catch (err) {
    if (err && (err.code === 11000 || err.code === 11001)) {
      snapshot = await ContestRepository.findFinalSnapshot(currentContest._id);
    } else {
      throw err;
    }
  }

  const updatedContest = await Contest.findOneAndUpdate(
    { _id: currentContest._id, status: CONTEST_STATUS.ENDED },
    { $set: { status: CONTEST_STATUS.FINALIZED } },
    { returnDocument: "after" },
  );

  const finalContest = updatedContest || (await Contest.findById(currentContest._id));

  return {
    contest: finalContest.toObject ? finalContest.toObject() : finalContest,
    snapshot: snapshot && snapshot.toObject ? snapshot.toObject() : snapshot,
    ...(auditRecord ? { audit: auditRecord.toObject ? auditRecord.toObject() : auditRecord } : {}),
  };
}

async function getContestStandings({ contestId, page = 1, limit = 50 }) {
  const contest = await ContestRepository.findById(contestId);
  if (!contest) {
    throw AppError.notFound("Contest not found");
  }

  const currentContest = await syncContestLifecycle(contest);
  const normalizedStatus = normalizeContestStatus(currentContest.status);

  if (normalizedStatus === CONTEST_STATUS.DRAFT) {
    throw AppError.notFound("Contest not found");
  }

  const allowedStatuses = [
    CONTEST_STATUS.RUNNING,
    CONTEST_STATUS.ENDED,
    CONTEST_STATUS.FINALIZED,
  ];
  if (!allowedStatuses.includes(normalizedStatus)) {
    throw AppError.badRequest("Standings are not available for this contest");
  }

  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
  const skip = (parsedPage - 1) * parsedLimit;

  // 1. FINALIZED: read from ContestLeaderboardSnapshot
  if (normalizedStatus === CONTEST_STATUS.FINALIZED) {
    const snapshot = await ContestRepository.findFinalSnapshot(currentContest._id);
    const allStandings = snapshot?.standings || [];
    const total = allStandings.length;
    const paged = allStandings.slice(skip, skip + parsedLimit);
    const standings = paged.map((s) => ({
      userId: s.userId,
      rank: s.rank,
      solvedCount: s.solvedCount,
      score: s.score ?? s.solvedCount,
      penalty: s.penalty,
      ...(s.lastAcceptedAt ? { lastAcceptedAt: s.lastAcceptedAt } : {}),
    }));

    return {
      contestId: currentContest._id,
      status: currentContest.status,
      standings,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages: Math.ceil(total / parsedLimit) || 0,
      },
    };
  }

  // 2. NON-FINALIZED (RUNNING / ENDED): prefer Redis, then use Mongo authority.
  if (normalizedStatus === CONTEST_STATUS.RUNNING || normalizedStatus === CONTEST_STATUS.ENDED) {
    try {
      return await standingsService.readRedisStandings({
        contest: currentContest,
        page: parsedPage,
        limit: parsedLimit,
      });
    } catch (error) {
      logger.warn({
        event: "redis_standings_read_fallback",
        contestId: String(currentContest._id),
        err: error,
      });
    }
  }

  const total = await ContestRepository.countParticipants(currentContest._id);
  if (total === 0) {
    return paginationResult({
      contest: currentContest,
      page: parsedPage,
      limit: parsedLimit,
      standings: [],
      total: 0,
    });
  }

  const participants = await ContestRepository.findParticipantsPaginated(
    currentContest._id,
    { skip, limit: parsedLimit },
  );

  const rankedParticipants = [];
  for (let index = 0; index < participants.length; index += 1) {
    const entry = participants[index];
    rankedParticipants.push({ ...entry, rank: skip + index + 1 });
  }

  return paginationResult({
    contest: currentContest,
    page: parsedPage,
    limit: parsedLimit,
    standings: rankedParticipants.map((participant) =>
      formatStanding({ contest: currentContest, participant, rank: participant.rank }),
    ),
    total,
  });
}

async function getMyContestStanding({ contestId, userId }) {
  if (!userId) {
    throw AppError.unauthorized("Authentication required");
  }

  const contest = await ContestRepository.findById(contestId);
  if (!contest) {
    throw AppError.notFound("Contest not found");
  }

  const currentContest = await syncContestLifecycle(contest);
  const normalizedStatus = normalizeContestStatus(currentContest.status);

  if (normalizedStatus === CONTEST_STATUS.DRAFT) {
    throw AppError.notFound("Contest not found");
  }

  const allowedStatuses = [
    CONTEST_STATUS.RUNNING,
    CONTEST_STATUS.ENDED,
    CONTEST_STATUS.FINALIZED,
  ];
  if (!allowedStatuses.includes(normalizedStatus)) {
    throw AppError.badRequest("Standings are not available for this contest");
  }

  // 1. FINALIZED: read from ContestLeaderboardSnapshot
  if (normalizedStatus === CONTEST_STATUS.FINALIZED) {
    const snapshot = await ContestRepository.findFinalSnapshot(currentContest._id);
    const standing = snapshot?.standings?.find(
      (s) => String(s.userId) === String(userId),
    );

    if (!standing) {
      throw AppError.notFound("Participant not registered for this contest");
    }

    const formattedStanding = {
      userId: standing.userId,
      rank: standing.rank,
      solvedCount: standing.solvedCount,
      score: standing.score ?? standing.solvedCount,
      penalty: standing.penalty,
      ...(standing.lastAcceptedAt ? { lastAcceptedAt: standing.lastAcceptedAt } : {}),
    };

    return {
      contestId: currentContest._id,
      standing: formattedStanding,
      ...formattedStanding,
    };
  }

  // 2. NON-FINALIZED (RUNNING / ENDED): prefer Redis, then use Mongo authority.
  let formattedStanding;
  try {
    formattedStanding = await standingsService.readRedisMyStanding({
      contest: currentContest,
      userId: normalizeObjectId(userId),
    });
  } catch (error) {
    logger.warn({
      event: "redis_personal_standings_read_fallback",
      contestId: String(currentContest._id),
      userId: String(userId),
      err: error,
    });
    const participant = await ContestRepository.findParticipant(currentContest._id, userId);
    if (!participant) {
      throw AppError.notFound("Participant not registered for this contest");
    }
    const aheadCount = await ContestRepository.countParticipantsAhead(
      currentContest._id,
      participant,
    );
    formattedStanding = formatStanding({
      contest: currentContest,
      participant,
      rank: aheadCount + 1,
    });
  }

  return {
    contestId: currentContest._id,
    standing: formattedStanding,
    ...formattedStanding,
  };
}

module.exports = {
  CONTEST_STATUS,
  VALID_TRANSITIONS,
  assertContestTransition,
  getNextContestLifecycleStatus,
  syncContestLifecycle,
  getContestById,
  listContests,
  createContest,
  transitionContestStatus,
  updateContest,
  registerParticipant,
  unregisterParticipant,
  getContestProblems,
  createContestSubmission,
  getContestSubmissions,
  finalizeContest,
  getContestStandings,
  getMyContestStanding,
};
