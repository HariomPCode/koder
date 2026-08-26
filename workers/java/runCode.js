const DockerSandbox = require("../common/dockerSandbox");

/**
 * Executes Java code inside an existing DockerSandbox container.
 */
async function runCode(sandbox, options = {}) {
  if (!(sandbox instanceof DockerSandbox)) {
    throw new Error("sandbox must be an instance of DockerSandbox");
  }
  return await sandbox.exec(["java", "Main"], options);
}

module.exports = runCode;
