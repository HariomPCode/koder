const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const connectDB = require("./db");
const createApp = require("./app");
const { startLeaderboardProjectionSweep } = require("./jobs/leaderboardProjectionSweep");
const { startSubmissionReconciliation } = require("./jobs/submissionReconciliation");
const app = createApp();

async function startServer() {
  await connectDB();

  app.listen(5000, () => {
    console.log("Server is running on port 5000");
  });
  startLeaderboardProjectionSweep();
  startSubmissionReconciliation();
}

if (require.main === module) {
  startServer();
}

module.exports = app;
