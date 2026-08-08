const fs = require("fs");

function cleanupSandbox(jobDir) {
  try {
    fs.rmSync(jobDir, {
      recursive: true,
      force: true,
    });
  } catch (err) {
    console.error("Failed to clean up sandbox:", err);
  }
}

module.exports = cleanupSandbox;
