const fs = require("fs");
const path = require("path");

// creates the directory only

function createSandbox(jobId) {
  const jobDir = path.join(__dirname, "temp", String(jobId));

  fs.mkdirSync(jobDir, {
    recursive: true,
  });

  return jobDir;
}

module.exports = createSandbox;
