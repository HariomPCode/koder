const runDocker = require("../common/runDocker");

async function runCode(jobDir) {
  const dockerPath = jobDir.replace(/\\/g, "/");

  return await runDocker(
    jobDir,
    [
      "run",
      "--rm",

      // IMPORTANT:
      // Keep stdin attached because runDocker()
      // sends testcase input through stdin.
      "-i",

      // Security
      "--network",
      "none",

      "--cap-drop",
      "ALL",

      "--security-opt",
      "no-new-privileges",

      // Resources
      "--memory=256m",
      "--cpus=1",
      "--pids-limit=64",

      "--read-only",

      "--tmpfs",
      "/tmp:size=64m",

      "--user=1000:1000",

      // Mount sandbox
      "-v",
      `${dockerPath}:/app`,

      "-w",
      "/app",

      // Java image
      "eclipse-temurin:17-jdk-alpine-3.23",

      // Execute
      "java",
      "Main",
    ],
    3000,
  );
}

module.exports = runCode;
