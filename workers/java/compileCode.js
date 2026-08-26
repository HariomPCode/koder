const DockerSandbox = require("../common/dockerSandbox");

/**
 * Compiles Java code inside an existing DockerSandbox container.
 */
async function compileCode(sandbox, options = {}) {
  if (!(sandbox instanceof DockerSandbox)) {
    throw new Error("sandbox must be an instance of DockerSandbox");
  }
  return await sandbox.exec(["javac", "Main.java"], options);
}

module.exports = compileCode;
