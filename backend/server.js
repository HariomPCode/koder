const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const connectDB = require("./db");
const createApp = require("./app");
const { startLeaderboardProjectionSweep } = require("./jobs/leaderboardProjectionSweep");
const { startSubmissionReconciliation } = require("./jobs/submissionReconciliation");
const { startContestScheduler } = require("./jobs/contestScheduler");
const { createLogger } = require("@koder/shared");
const logger = createLogger("backend.server");
const app = createApp();

async function startServer() {
  await connectDB();

  app.listen(5000, () => {
    logger.info({ event: "server_listening", port: 5000 });
  });
  startLeaderboardProjectionSweep();
  startSubmissionReconciliation();
  startContestScheduler();
}

if (require.main === module) {
  startServer();
}

module.exports = app;
