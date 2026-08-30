const languages = require("./config/languages");
const queues = require("./config/queues");
const verdicts = require("./contracts/verdicts");
const protocol = require("./contracts/protocol");
const templateGenerator = require("./engine/templateGenerator");
const Question = require("./models/Question");
const Submission = require("./models/Submission");
const Contest = require("./models/Contest");
const ContestParticipant = require("./models/ContestParticipant");
const ContestLeaderboardSnapshot = require("./models/ContestLeaderboardSnapshot");
const dbCalls = require("./db/dbCalls");

module.exports = {
  ...languages,
  ...queues,
  ...verdicts,
  ...protocol,
  ...templateGenerator,
  Question,
  Submission,
  Contest,
  ContestParticipant,
  ContestLeaderboardSnapshot,
  ...dbCalls,
};
