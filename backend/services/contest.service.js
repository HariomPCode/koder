const { Contest, ContestParticipant, Question, Submission, SUPPORTED_LANGUAGES, normalizeLanguage, SUBMISSION_STATUS } = require("@koder/shared");
const ContestRepository = require("../repositories/contest.repository");
const AppError = require("../errors/appError");
const queue = require("../queue");
const { validateSubmissionPayload } = require("../validators/request.validators");

const CONTEST_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  REGISTRATION: "REGISTRATION",
  RUNNING: "RUNNING",
  ENDED: "ENDED",
  FINALIZED: "FINALIZED",
});

const VALID_TRANSITIONS = Object.freeze({
  [CONTEST_STATUS.DRAFT]: [CONTEST_STATUS.SCHEDULED],
  [CONTEST_STATUS.SCHEDULED]: [CONTEST_STATUS.REGISTRATION],
  [CONTEST_STATUS.REGISTRATION]: [CONTEST_STATUS.RUNNING],
  [CONTEST_STATUS.RUNNING]: [CONTEST_STATUS.ENDED],
  [CONTEST_STATUS.ENDED]: [CONTEST_STATUS.FINALIZED],
  [CONTEST_STATUS.FINALIZED]: [],
});

function normalizeContestStatus(status) {
  return String(status || "").trim().toUpperCase();
}

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

  const now = Date.now();
  const registrationOpenTime = contest.registrationOpenTime ? new Date(contest.registrationOpenTime).getTime() : null;
  const startTime = contest.startTime ? new Date(contest.startTime).getTime() : null;
  const endTime = contest.endTime ? new Date(contest.endTime).getTime() : null;

  let nextStatus = normalizeContestStatus(contest.status);

  if (nextStatus === CONTEST_STATUS.SCHEDULED && registrationOpenTime !== null && now >= registrationOpenTime) {
    nextStatus = CONTEST_STATUS.REGISTRATION;
  }

  if (nextStatus === CONTEST_STATUS.REGISTRATION && startTime !== null && now >= startTime) {
    nextStatus = CONTEST_STATUS.RUNNING;
  }

  if (nextStatus === CONTEST_STATUS.RUNNING && endTime !== null && now >= endTime) {
    nextStatus = CONTEST_STATUS.ENDED;
  }

  if (nextStatus !== contest.status) {
    contest.status = nextStatus;
    await contest.save();
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

async function listContests() {
  const contests = await ContestRepository.findAll();
  return { contests };
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

  if (normalizedTarget === CONTEST_STATUS.FINALIZED && currentStatus !== CONTEST_STATUS.ENDED) {
    throw AppError.badRequest("Contest must be ENDED before it can be FINALIZED");
  }

  contest.status = normalizedTarget;
  await contest.save();
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

  if (userId) {
    const participant = await ContestRepository.findParticipant(contestId, userId);
    if (!participant && currentContest.status !== CONTEST_STATUS.ENDED && currentContest.status !== CONTEST_STATUS.FINALIZED) {
      throw AppError.forbidden("You must register before viewing contest problems");
    }
  }

  const problemIds = currentContest.problems.map((problem) => problem.questionId);
  const questions = await Question.find({ _id: { $in: problemIds } }).lean();
  const questionMap = new Map(questions.map((question) => [String(question._id), question]));

  return {
    contest: currentContest.toObject ? currentContest.toObject() : currentContest,
    problems: currentContest.problems.map((problem) => ({
      ...problem.toObject ? problem.toObject() : problem,
      question: questionMap.get(String(problem.questionId)) || null,
    })),
  };
}

async function createContestSubmission({ contestId, userId, payload }) {
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

  const submission = await ContestRepository.createSubmission({
    userId,
    questionId: question._id,
    contestId: currentContest._id,
    contestProblemId: contestProblem._id,
    submittedAtContestMs,
    code: normalizedPayload.code,
    language: normalizedLanguage,
    status: SUBMISSION_STATUS.CREATED,
  });

  try {
    await queue.enqueueSubmission({
      submissionId: submission._id,
      userId,
      questionId: question._id,
      language: normalizedLanguage,
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

async function getContestSubmissions({ contestId, userId = null, requesterUserId = null }) {
  const contest = await ContestRepository.findById(contestId);
  if (!contest) {
    throw AppError.notFound("Contest not found");
  }

  if (requesterUserId && String(requesterUserId) !== String(userId) && requesterUserId !== userId) {
    // no-op: allowed to filter by their own submissions in the API layer
  }

  const submissions = await ContestRepository.listSubmissions(contestId, userId || null);
  return { submissions };
}

async function finalizeContest({ contestId, actorUserId }) {
  const contest = await ContestRepository.findById(contestId);
  if (!contest) {
    throw AppError.notFound("Contest not found");
  }

  const actor = await require("../models/User").findById(actorUserId);
  if (!actor || actor.role !== "admin") {
    throw AppError.forbidden("Only admins may finalize contests");
  }

  if (contest.status === CONTEST_STATUS.FINALIZED) {
    return { contest };
  }

  if (contest.status !== CONTEST_STATUS.ENDED) {
    throw AppError.badRequest("Contest must be ENDED before finalization");
  }

  contest.status = CONTEST_STATUS.FINALIZED;
  await contest.save();

  return { contest };
}

module.exports = {
  CONTEST_STATUS,
  VALID_TRANSITIONS,
  assertContestTransition,
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
};
