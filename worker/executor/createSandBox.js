const fs = require("fs");
const { join } = require("path");

function createSandBox(jobId, code) {
  const jobDir = join(__dirname, "temp", String(jobId));

  const dockerPath = jobDir.replace(/\\/g, "/");
  fs.mkdirSync(jobDir, { recursive: true });
  const filePath = join(jobDir, "app.js");
  fs.writeFileSync(filePath, code);

  const dockerArgs = [
    "run",
    "-i",
    "--rm",
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory=256m",
    "--cpus=1",
    "--pids-limit=64",
    "--read-only",
    "--tmpfs",
    "/tmp:size=64m",
    "--user=1000:1000",
    "-v",
    `${dockerPath}:/app:ro`,
    "-w",
    "/app",
    "node:20-alpine",
    "node",
    "app.js",
  ];

  return {
    jobDir,
    dockerArgs,
  };
}

module.exports = createSandBox;
