const DockerSandbox = require("../common/dockerSandbox");

/**
 * Executes JavaScript code inside an existing DockerSandbox container.
 */
async function runCode(sandbox, options = {}) {
  if (!(sandbox instanceof DockerSandbox)) {
    throw new Error("sandbox must be an instance of DockerSandbox");
  }
  return await sandbox.exec(["node", "app.js"], options);
}

module.exports = runCode;
