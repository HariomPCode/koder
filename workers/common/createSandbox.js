const fs = require("fs");
const path = require("path");

const SANDBOX_ROOT = path.resolve(__dirname, "temp");
const EXECUTION_KEY_PATTERN = /^[a-z][a-z0-9_-]*$/;

function createSandbox(executionKey) {
  if (
    typeof executionKey !== "string" ||
    !EXECUTION_KEY_PATTERN.test(executionKey)
  ) {
    throw new Error("Invalid sandbox execution key");
  }

  const jobDir = path.resolve(SANDBOX_ROOT, executionKey);
  const relativePath = path.relative(SANDBOX_ROOT, jobDir);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Sandbox directory must remain inside the sandbox root");
  }

  fs.mkdirSync(jobDir, {
    recursive: true,
  });

  return jobDir;
}

createSandbox.SANDBOX_ROOT = SANDBOX_ROOT;

module.exports = createSandbox;
