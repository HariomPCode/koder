const languages = require("./config/languages");
const queues = require("./config/queues");
const verdicts = require("./contracts/verdicts");
const scoring = require("./contracts/scoring");
const protocol = require("./contracts/protocol");
const templateGenerator = require("./engine/templateGenerator");
const Question = require("./models/Question");
const Submission = require("./models/Submission");
const Contest = require("./models/Contest");
const ContestParticipant = require("./models/ContestParticipant");
const ContestParticipantProblem = require("./models/ContestParticipantProblem");
const ContestScoredSubmission = require("./models/ContestScoredSubmission");
const ContestLeaderboardSnapshot = require("./models/ContestLeaderboardSnapshot");
const dbCalls = require("./db/dbCalls");
const scoringProcessor = require("./scoring/applySubmissionResult");

module.exports = {
  ...languages,
  ...queues,
  ...verdicts,
  ...scoring,
  ...protocol,
  ...templateGenerator,
  Question,
  Submission,
  Contest,
  ContestParticipant,
  ContestParticipantProblem,
  ContestScoredSubmission,
  ContestLeaderboardSnapshot,
  ...dbCalls,
  ...scoringProcessor,
};
