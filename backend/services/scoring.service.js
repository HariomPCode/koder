const { applySubmissionResult } = require("@koder/shared");
const {
  reconcileContestScoring,
  reconcileParticipantScoring,
} = require("./scoring-reconcile.service");

module.exports = {
  applySubmissionResult,
  reconcileContestScoring,
  reconcileParticipantScoring,
};
