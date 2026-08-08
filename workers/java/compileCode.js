const runDocker = require("../common/runDocker");

async function compileCode(jobDir) {
  const dockerPath = jobDir.replace(/\\/g, "/");

  return await runDocker(
    jobDir,
    [
      "run",
      "--rm",

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

      // Compile
      "javac",
      "Main.java",
    ],
    10000,
  );
}

module.exports = compileCode;
