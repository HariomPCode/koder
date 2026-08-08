const runDocker = require("../common/runDocker");

async function runCode(jobDir) {
  const dockerPath = jobDir.replace(/\\/g, "/");
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

  return await runDocker(jobDir, dockerArgs, 3000);
}

module.exports = runCode;
