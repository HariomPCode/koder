const fs = require("fs");
const { createLogger } = require("@koder/shared");
const logger = createLogger("worker.sandbox");

function cleanupSandbox(jobDir) {
  try {
    fs.rmSync(jobDir, {
      recursive: true,
      force: true,
    });
  } catch (err) {
    logger.error({ event: "sandbox_directory_cleanup_failed", err });
  }
}

module.exports = cleanupSandbox;
