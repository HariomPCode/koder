const { spawn } = require("child_process");

function runCode(input, dockerArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", dockerArgs);

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdin.write(input);
    child.stdin.end();

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 3000);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (timedOut) {
        return reject(new Error("Time Limit Exceeded"));
      }

      if (code !== 0) {
        return reject(new Error(stderr || `Process exited with code ${code}`));
      }

      resolve(stdout.trim());
    });
  });
}

module.exports = runCode;
