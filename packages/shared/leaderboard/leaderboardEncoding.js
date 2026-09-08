const USER_ID_PATTERN = /^[0-9a-f]{24}$/;
const MEMBER_PATTERN = /^([0-9]{10})\|([0-9]{16})\|([0-9a-f]{24})$/;

const MAX_SOLVED_COUNT = 2 ** 31 - 1;
const MAX_TOTAL_PENALTY = 2 ** 32 - 1;
const MAX_LAST_ACCEPTED_CONTEST_MS = 2 ** 53 - 1;
const UNSOLVED_LAST_ACCEPTED_CONTEST_MS = "9999999999999999";
const PENALTY_WIDTH = 10;
const LAST_ACCEPTED_WIDTH = 16;

function assertIntegerInRange(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  }
}

function normalizeObjectId(value, name = "userId") {
  const normalized = String(value || "").toLowerCase();
  if (!USER_ID_PATTERN.test(normalized)) {
    throw new TypeError(`${name} must be a 24-character lowercase Mongo ObjectId`);
  }
  return normalized;
}

function normalizeContestId(value) {
  return normalizeObjectId(value, "contestId");
}

function normalizeGeneration(value) {
  const normalized = String(value || "");
  if (!normalized || normalized.includes(":") || normalized.includes("|")) {
    throw new TypeError("generation must be a non-empty Redis-safe token");
  }
  return normalized;
}

function encodeSolvedCount(solvedCount) {
  assertIntegerInRange(solvedCount, "solvedCount", 0, MAX_SOLVED_COUNT);
  return solvedCount === 0 ? 0 : -solvedCount;
}

function encodeMember({ totalPenalty, lastAcceptedContestMs, userId }) {
  assertIntegerInRange(totalPenalty, "totalPenalty", 0, MAX_TOTAL_PENALTY);

  if (lastAcceptedContestMs != null) {
    assertIntegerInRange(
      lastAcceptedContestMs,
      "lastAcceptedContestMs",
      0,
      MAX_LAST_ACCEPTED_CONTEST_MS,
    );
  }

  const penaltyToken = String(totalPenalty).padStart(PENALTY_WIDTH, "0");
  const lastAcceptedToken =
    lastAcceptedContestMs == null
      ? UNSOLVED_LAST_ACCEPTED_CONTEST_MS
      : String(lastAcceptedContestMs).padStart(LAST_ACCEPTED_WIDTH, "0");

  return `${penaltyToken}|${lastAcceptedToken}|${normalizeObjectId(userId)}`;
}

function decodeMember(member) {
  if (typeof member !== "string") {
    throw new TypeError("member must be a string");
  }

  const match = MEMBER_PATTERN.exec(member);
  if (!match) {
    throw new TypeError("member has an invalid leaderboard token");
  }

  const totalPenalty = Number(match[1]);
  const lastAcceptedToken = match[2];
  const lastAcceptedContestMs =
    lastAcceptedToken === UNSOLVED_LAST_ACCEPTED_CONTEST_MS
      ? null
      : Number(lastAcceptedToken);

  assertIntegerInRange(totalPenalty, "totalPenalty", 0, MAX_TOTAL_PENALTY);
  if (lastAcceptedContestMs !== null) {
    assertIntegerInRange(
      lastAcceptedContestMs,
      "lastAcceptedContestMs",
      0,
      MAX_LAST_ACCEPTED_CONTEST_MS,
    );
  }

  return {
    totalPenalty,
    lastAcceptedContestMs,
    userId: normalizeObjectId(match[3]),
  };
}

function encodeParticipant(participant) {
  return {
    score: encodeSolvedCount(participant.solvedCount ?? 0),
    member: encodeMember({
      totalPenalty: participant.totalPenalty ?? 0,
      lastAcceptedContestMs: participant.lastAcceptedContestMs ?? null,
      userId: participant.userId,
    }),
  };
}

function decodeParticipant({ score, member }) {
  if (typeof score !== "number" && typeof score !== "string") {
    throw new TypeError("score must be a number or numeric string");
  }

  const numericScore = Number(score);
  if (!Number.isSafeInteger(numericScore) || numericScore > 0 || numericScore < -MAX_SOLVED_COUNT) {
    throw new RangeError(`score must be an integer in [-${MAX_SOLVED_COUNT}, 0]`);
  }

  return {
    solvedCount: -numericScore,
    ...decodeMember(member),
  };
}

module.exports = {
  MAX_SOLVED_COUNT,
  MAX_TOTAL_PENALTY,
  MAX_LAST_ACCEPTED_CONTEST_MS,
  UNSOLVED_LAST_ACCEPTED_CONTEST_MS,
  PENALTY_WIDTH,
  LAST_ACCEPTED_WIDTH,
  normalizeObjectId,
  normalizeContestId,
  normalizeGeneration,
  encodeSolvedCount,
  encodeMember,
  decodeMember,
  encodeParticipant,
  decodeParticipant,
};
