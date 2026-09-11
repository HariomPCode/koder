const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const DockerSandbox = require("../../common/dockerSandbox");
const { createExecutionExecutor } = require("../../common/executionEngine");
const jsExecutor = require("../../javascript/executor");
const javaExecutor = require("../../java/executor");

class ScenarioSandbox {
  constructor(scenario) {
    this.scenario = scenario;
  }

  async start() {
    if (this.scenario === "startup") {
      const error = new Error("Docker daemon unavailable");
      error.code = "DOCKER_UNAVAILABLE";
      throw error;
    }
  }

  async exec() {
    if (this.scenario === "compile-infrastructure") {
      return {
        code: 1,
        stdout: "",
        stderr: "Cannot connect to the Docker daemon",
        timedOut: false,
        runtimeMs: 1,
        infrastructureError: new Error("Docker API unavailable"),
      };
    }
    if (this.scenario === "compile-user") {
      return {
        code: 1,
        stdout: "",
        stderr: "syntax error",
        timedOut: false,
        runtimeMs: 1,
      };
    }
    return { code: 0, stdout: "", stderr: "", timedOut: false, runtimeMs: 1 };
  }

  async runInteractiveBatch() {
    if (this.scenario === "batch-infrastructure") {
      return { infrastructureError: new Error("Docker exec API failed") };
    }
    if (this.scenario === "timeout") {
      return {
        results: new Map(),
        timedOutTestCaseId: 0,
        overallTimedOut: false,
        crashedTestCaseId: null,
        stderr: "",
      };
    }
    if (this.scenario === "runtime") {
      return {
        results: new Map([[
          0,
          { id: 0, status: "ERROR", output: "", error: "user exception", runtimeMs: 1 },
        ]]),
        timedOutTestCaseId: null,
        overallTimedOut: false,
        crashedTestCaseId: null,
        stderr: "",
      };
    }
    return {
      results: new Map([[0, {
        id: 0,
        status: "OK",
        output: "true",
        error: null,
        runtimeMs: 1,
      }]]),
      timedOutTestCaseId: null,
      overallTimedOut: false,
      crashedTestCaseId: null,
      stderr: "",
    };
  }

  async destroy() {}
}

function createExecutor(scenario, updates) {
  const executor = scenario.startsWith("compile") ? javaExecutor : jsExecutor;
  const details = {
    language: executor.config.language,
    code: "function solve() { return true; }",
    slug: "two-sum",
    functionName: null,
    parameters: [],
    returnType: null,
    testcases: [{ input: "case", output: "true" }],
  };
  return createExecutionExecutor(executor.config, {
    getQuestionDetails: async () => details,
    updateSubmission: async (_id, result) => {
      updates.push(result);
      return result;
    },
    createSandbox: () => fs.mkdtempSync(path.join(os.tmpdir(), "koder-p2-failure-")),
    cleanupSandbox: (dir) => fs.rmSync(dir, { recursive: true, force: true }),
    DockerSandbox: class extends ScenarioSandbox {
      constructor() {
        super(scenario);
      }
    },
  });
}

async function runTests() {
  for (const scenario of ["startup", "batch-infrastructure", "compile-infrastructure"]) {
    const updates = [];
    await assert.rejects(
      () => createExecutor(scenario, updates)({
        id: `p2-${scenario}`,
        data: { submissionId: `submission-${scenario}` },
      }),
      (error) => error.code === "DOCKER_UNAVAILABLE" || error.code === "SANDBOX_EXEC_FAILED",
    );
    assert.strictEqual(updates.length, 0);
  }

  for (const scenario of ["compile-user", "runtime", "timeout"]) {
    const updates = [];
    const result = await createExecutor(scenario, updates)({
      id: `p2-${scenario}`,
      data: { submissionId: `submission-${scenario}` },
    });
    assert.strictEqual(result.failureType, "user_code");
    assert.strictEqual(updates[0].failureType, "user_code");
  }

  const invalidImageSandbox = new DockerSandbox({
    jobId: "p2-invalid-image",
    jobDir: process.cwd(),
    image: "koder/nonexistent-image-for-p2-validation:never",
  });
  await assert.rejects(() => invalidImageSandbox.start(), /Docker sandbox failed to start/i);

  console.log("P2 failure classification tests passed");
}

runTests().catch((error) => {
  console.error("P2 failure classification tests failed:", error);
  process.exit(1);
});
