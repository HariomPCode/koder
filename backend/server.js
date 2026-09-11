const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const connectDB = require("./db");
const createApp = require("./app");
const { startLeaderboardProjectionSweep } = require("./jobs/leaderboardProjectionSweep");
const { startSubmissionReconciliation } = require("./jobs/submissionReconciliation");
const { startContestScheduler } = require("./jobs/contestScheduler");
const { createContestLeaderboardLifecycle } = require("./services/contestLeaderboardLifecycle");
const eventBus = require("./events/eventBus");
const { createLogger } = require("@koder/shared");
const logger = createLogger("backend.server");
const app = createApp();

async function startServer() {
  await connectDB();

  const httpServer = app.listen(5000, () => {
    logger.info({ event: "server_listening", port: 5000 });
  });
  startLeaderboardProjectionSweep();
  startSubmissionReconciliation();
  const lifecycle = createContestLeaderboardLifecycle({
    distributedSnapshotLock: true,
  });
  const contestScheduler = startContestScheduler({
    onRunning: (contestId) => lifecycle.preseedContest(contestId),
  });
  const snapshotScheduler = lifecycle.start();
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    contestScheduler.stop();
    snapshotScheduler.stop();
    await eventBus.close();
    await new Promise((resolve) => httpServer.close(resolve));
    logger.info({ event: "server_shutdown_complete", signal });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM").catch((error) => {
    logger.error({ event: "server_shutdown_failed", signal: "SIGTERM", err: error });
    process.exitCode = 1;
  }));
  process.once("SIGINT", () => shutdown("SIGINT").catch((error) => {
    logger.error({ event: "server_shutdown_failed", signal: "SIGINT", err: error });
    process.exitCode = 1;
  }));
}

if (require.main === module) {
  startServer();
}

module.exports = app;
