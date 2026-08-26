const { spawn } = require("child_process");
const { performance } = require("perf_hooks");
const readline = require("readline");
const { encodeRequest, decodeResponse } = require("./protocol");

/**
 * DockerSandbox manages the lifecycle of a single Docker container for an entire submission.
 * It provides interactive per-testcase streaming sessions, watchdog timeouts,
 * process tree cleanup, output limits, and container destruction.
 */
class DockerSandbox {
  constructor({
    jobId,
    jobDir,
    image,
    memory = "256m",
    cpus = "1",
    pidsLimit = 64,
    readOnly = true,
    tmpfsSize = "64m",
    idleTimeoutSeconds = 120,
  }) {
    this.jobId = String(jobId);
    this.jobDir = jobDir;
    this.image = image;
    this.memory = memory;
    this.cpus = cpus;
    this.pidsLimit = pidsLimit;
    this.readOnly = readOnly;
    this.tmpfsSize = tmpfsSize;
    this.idleTimeoutSeconds = idleTimeoutSeconds;

    // Unique container name per submission execution
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    this.containerName = `sandbox-${this.jobId}-${Date.now()}-${randomSuffix}`;
    this.isStarted = false;
    this.isDestroyed = false;
  }

  /**
   * Start the isolated Docker sandbox container in detached mode.
   * Container runs `sleep <idleTimeoutSeconds>` as an idle watchdog.
   */
  async start() {
    if (this.isStarted) return;

    // Format path for Docker volume mounting across Windows and Linux
    const dockerHostPath = this.jobDir.replace(/\\/g, "/");

    const dockerArgs = [
      "run",
      "-d",
      "--name",
      this.containerName,
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      `--memory=${this.memory}`,
      `--cpus=${this.cpus}`,
      `--pids-limit=${this.pidsLimit}`,
      this.readOnly ? "--read-only" : "--read-only=false",
      "--tmpfs",
      `/tmp:size=${this.tmpfsSize}`,
      "-v",
      `${dockerHostPath}:/app`,
      "-w",
      "/app",
      this.image,
      "sleep",
      String(this.idleTimeoutSeconds),
    ];

    await new Promise((resolve, reject) => {
      const child = spawn("docker", dockerArgs);
      let stderr = "";

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", (err) => {
        reject(new Error(`Failed to start Docker sandbox: ${err.message}`));
      });

      child.on("close", (code) => {
        if (code === 0) {
          this.isStarted = true;
          resolve();
        } else {
          reject(
            new Error(
              `Docker sandbox failed to start (exit code ${code}): ${stderr.trim()}`,
            ),
          );
        }
      });
    });
  }

  /**
   * Forcefully kills all worker/language processes inside the container to prevent orphan leaks.
   * @param {string} [pattern="node|java|javac"]
   */
  async killAllExecProcesses(pattern = "node|java|javac") {
    if (!this.isStarted || this.isDestroyed) return;
    try {
      await new Promise((resolve) => {
        const child = spawn("docker", [
          "exec",
          this.containerName,
          "pkill",
          "-9",
          "-f",
          pattern,
        ]);
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      });
    } catch (_) {}
  }

  /**
   * Executes a one-shot command inside the running sandbox container (e.g. javac compilation).
   *
   * @param {string[]} command
   * @param {Object} options
   * @returns {Promise<{ code: number, stdout: string, stderr: string, timedOut: boolean, runtimeMs: number }>}
   */
  async exec(
    command,
    { input = null, timeoutMs = 15000, maxBuffer = 5 * 1024 * 1024 } = {},
  ) {
    if (!this.isStarted || this.isDestroyed) {
      throw new Error("Cannot exec in a sandbox that is not running");
    }

    const execArgs = ["exec", "-i", this.containerName, ...command];

    return new Promise((resolve) => {
      const startTime = performance.now();
      const child = spawn("docker", execArgs);

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let isClosed = false;

      const timer = setTimeout(async () => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch (_) {}
        await this.killAllExecProcesses();
      }, timeoutMs);

      if (input !== null && input !== undefined) {
        child.stdin.write(String(input));
      }
      child.stdin.end();

      child.stdout.on("data", (data) => {
        const str = data.toString();
        if (stdout.length + str.length <= maxBuffer) {
          stdout += str;
        }
      });

      child.stderr.on("data", (data) => {
        const str = data.toString();
        if (stderr.length + str.length <= maxBuffer) {
          stderr += str;
        }
      });

      child.on("error", async (err) => {
        clearTimeout(timer);
        if (!isClosed) {
          isClosed = true;
          await this.killAllExecProcesses();
          const runtimeMs = performance.now() - startTime;
          resolve({
            code: 1,
            stdout,
            stderr: stderr || err.message,
            timedOut: false,
            runtimeMs,
          });
        }
      });

      child.on("close", async (code) => {
        clearTimeout(timer);
        if (!isClosed) {
          isClosed = true;
          const runtimeMs = performance.now() - startTime;
          resolve({
            code: timedOut ? 124 : (code ?? 1),
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            timedOut,
            runtimeMs,
          });
        }
      });
    });
  }

  /**
   * Executes an interactive streaming batch of testcases with true per-testcase watchdogs.
   *
   * @param {string[]} command - e.g. ["node", "app.js"] or ["java", "Main"]
   * @param {Array<{ id: number, input: string, output: string }>} batchTestCases
   * @param {Object} options
   * @param {number} [options.perTestTimeoutMs=2000]
   * @param {number} [options.overallDeadline=Infinity]
   * @param {number} [options.maxBuffer=5242880]
   * @returns {Promise<{ results: Map<number, { id: number, status: string, output: string, error: string, runtimeMs: number }>, timedOutTestCaseId: number|null, overallTimedOut: boolean, crashedTestCaseId: number|null, stderr: string }>}
   */
  async runInteractiveBatch(
    command,
    batchTestCases,
    {
      perTestTimeoutMs = 2000,
      overallDeadline = Infinity,
      maxBuffer = 5 * 1024 * 1024,
    } = {},
  ) {
    if (!this.isStarted || this.isDestroyed) {
      throw new Error("Cannot exec in a sandbox that is not running");
    }

    const execArgs = ["exec", "-i", this.containerName, ...command];
    const child = spawn("docker", execArgs);

    const results = new Map();
    let stderr = "";
    let isProcessExited = false;
    let timedOutTestCaseId = null;
    let overallTimedOut = false;
    let crashedTestCaseId = null;

    child.stderr.on("data", (chunk) => {
      if (stderr.length < maxBuffer) {
        stderr += chunk.toString();
      }
    });

    const rl = readline.createInterface({
      input: child.stdout,
      terminal: false,
    });

    let currentResponseResolver = null;

    rl.on("line", (line) => {
      const resp = decodeResponse(line);
      if (resp && currentResponseResolver) {
        const resolver = currentResponseResolver;
        currentResponseResolver = null;
        resolver(resp);
      }
    });

    child.on("close", () => {
      isProcessExited = true;
      if (currentResponseResolver) {
        const resolver = currentResponseResolver;
        currentResponseResolver = null;
        resolver(null);
      }
    });

    child.on("error", () => {
      isProcessExited = true;
      if (currentResponseResolver) {
        const resolver = currentResponseResolver;
        currentResponseResolver = null;
        resolver(null);
      }
    });

    try {
      for (const tc of batchTestCases) {
        if (isProcessExited) {
          crashedTestCaseId = tc.id;
          break;
        }

        // Check overall submission deadline
        if (Date.now() >= overallDeadline) {
          overallTimedOut = true;
          timedOutTestCaseId = tc.id;
          break;
        }

        const remainingDeadline = overallDeadline - Date.now();
        const effectiveTimeout = Math.min(perTestTimeoutMs, remainingDeadline);

        const caseStart = performance.now();
        const requestLine = encodeRequest(tc.id, tc.input);

        // Send testcase to runner process stdin
        try {
          child.stdin.write(requestLine);
        } catch (_) {
          crashedTestCaseId = tc.id;
          break;
        }

        // Await response with true per-testcase watchdog
        let watchdogTimer = null;
        let isTimedOut = false;

        const responsePromise = new Promise((resolve) => {
          currentResponseResolver = resolve;
          watchdogTimer = setTimeout(async () => {
            isTimedOut = true;
            timedOutTestCaseId = tc.id;
            try {
              child.kill("SIGKILL");
            } catch (_) {}
            await this.killAllExecProcesses();
            if (currentResponseResolver) {
              const r = currentResponseResolver;
              currentResponseResolver = null;
              r(null);
            }
          }, effectiveTimeout);
        });

        const resp = await responsePromise;
        clearTimeout(watchdogTimer);

        if (isTimedOut) {
          break;
        }

        if (!resp) {
          // Process exited or crashed unexpectedly
          crashedTestCaseId = tc.id;
          break;
        }

        const caseRuntime = performance.now() - caseStart;
        results.set(tc.id, {
          id: tc.id,
          status: resp.status,
          output: resp.status === "OK" ? resp.payload : "",
          error: resp.status !== "OK" ? resp.payload : null,
          runtimeMs: caseRuntime,
        });

        // If this test case failed (fatal error, runtime error, etc.), abort immediately
        if (resp.status !== "OK") {
          break;
        }

        // Validate output immediately to abort batch early if Wrong Answer
        const actualOutput = (resp.payload || "").trim().replace(/\r\n/g, "\n");
        const expectedOutput = (tc.output || "").trim().replace(/\r\n/g, "\n");
        if (actualOutput !== expectedOutput) {
          // Wrong Answer - stop sending further cases in this batch
          break;
        }
      }
    } finally {
      // Graceful shutdown: send EXIT signal
      try {
        if (!isProcessExited) {
          child.stdin.write("EXIT\n");
          child.stdin.end();
        }
      } catch (_) {}

      // Hard kill any lingering child processes in container
      try {
        child.kill("SIGKILL");
      } catch (_) {}
      await this.killAllExecProcesses();
      rl.close();
    }

    return {
      results,
      timedOutTestCaseId,
      overallTimedOut,
      crashedTestCaseId,
      stderr: stderr.trim(),
    };
  }

  /**
   * Destroy the Docker sandbox container forcefully.
   */
  async destroy() {
    if (this.isDestroyed || !this.isStarted) return;
    this.isDestroyed = true;

    try {
      await new Promise((resolve) => {
        const child = spawn("docker", ["rm", "-f", this.containerName]);
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      });
    } catch (err) {
      console.error(`Failed to remove container ${this.containerName}:`, err);
    }
  }
}

module.exports = DockerSandbox;
