const languages = require("./config/languages");
const queues = require("./config/queues");
const leaderboardConfig = require("./config/leaderboard");
const verdicts = require("./contracts/verdicts");
const scoring = require("./contracts/scoring");
const protocol = require("./contracts/protocol");
const leaderboardEncoding = require("./leaderboard/leaderboardEncoding");
const projectionIntegration = require("./leaderboard/projectionIntegration");
const templateGenerator = require("./engine/templateGenerator");
const Question = require("./models/Question");
const Submission = require("./models/Submission");
const Contest = require("./models/Contest");
const ContestParticipant = require("./models/ContestParticipant");
const ContestParticipantProblem = require("./models/ContestParticipantProblem");
const ContestScoredSubmission = require("./models/ContestScoredSubmission");
const ContestLeaderboardSnapshot = require("./models/ContestLeaderboardSnapshot");
const ContestFinalizationAudit = require("./models/ContestFinalizationAudit");
const dbCalls = require("./db/dbCalls");
const scoringProcessor = require("./scoring/applySubmissionResult");

module.exports = {
  ...languages,
  ...queues,
  ...leaderboardConfig,
  ...verdicts,
  ...scoring,
  ...protocol,
  ...leaderboardEncoding,
  ...projectionIntegration,
  ...templateGenerator,
  Question,
  Submission,
  Contest,
  ContestParticipant,
  ContestParticipantProblem,
  ContestScoredSubmission,
  ContestLeaderboardSnapshot,
  ContestFinalizationAudit,
  ...dbCalls,
  ...scoringProcessor,
};
