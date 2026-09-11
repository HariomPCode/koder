const CONTEST_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  REGISTRATION: "REGISTRATION",
  RUNNING: "RUNNING",
  ENDED: "ENDED",
  FINALIZED: "FINALIZED",
});

function normalizeContestStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function getNextContestLifecycleStatus(contest, now = Date.now()) {
  if (!contest) {
    return null;
  }

  const registrationOpenTime = contest.registrationOpenTime
    ? new Date(contest.registrationOpenTime).getTime()
    : null;
  const startTime = contest.startTime ? new Date(contest.startTime).getTime() : null;
  const endTime = contest.endTime ? new Date(contest.endTime).getTime() : null;
  const currentStatus = normalizeContestStatus(contest.status);

  if (
    currentStatus === CONTEST_STATUS.SCHEDULED &&
    registrationOpenTime !== null &&
    now >= registrationOpenTime
  ) {
    return CONTEST_STATUS.REGISTRATION;
  }

  if (
    currentStatus === CONTEST_STATUS.REGISTRATION &&
    startTime !== null &&
    now >= startTime
  ) {
    return CONTEST_STATUS.RUNNING;
  }

  if (
    currentStatus === CONTEST_STATUS.RUNNING &&
    endTime !== null &&
    now >= endTime
  ) {
    return CONTEST_STATUS.ENDED;
  }

  return currentStatus;
}

module.exports = {
  CONTEST_STATUS,
  normalizeContestStatus,
  getNextContestLifecycleStatus,
};
