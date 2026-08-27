const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const jsExecutor = require("./javascript/executor");
const javaExecutor = require("./java/executor");
const {
  createExecutionExecutor,
  compareOutputs,
} = require("./common/executionEngine");

class FakeSandbox {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.commands = [];
    this.started = false;
    this.destroyed = false;
    FakeSandbox.instances.push(this);
  }

  async start() {
    this.started = true;
  }

  async exec(command) {
    this.commands.push({ type: "exec", command });
    return {
      code: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      runtimeMs: 3,
    };
  }

  async runInteractiveBatch(command, testcases) {
    this.commands.push({ type: "run", command });
    return {
      results: new Map(
        testcases.map((testcase) => [
          testcase.id,
          {
            id: testcase.id,
            status: "OK",
            output: testcase.output,
            error: null,
            runtimeMs: 2,
          },
        ]),
      ),
      timedOutTestCaseId: null,
      overallTimedOut: false,
      crashedTestCaseId: null,
      stderr: "",
    };
  }

  async destroy() {
    this.destroyed = true;
  }
}

function createDependencies(details, updates) {
  return {
    getQuestionDetails: async () => details,
    updateSubmission: async (submissionId, result) => {
      updates.push({ submissionId, result });
      return result;
    },
    createSandbox: () =>
      fs.mkdtempSync(path.join(os.tmpdir(), "koder-execution-test-")),
    cleanupSandbox: (jobDir) =>
      fs.rmSync(jobDir, { recursive: true, force: true }),
    DockerSandbox: FakeSandbox,
  };
}

async function testLanguageExecutor(name, executor, expectedCommand) {
  const updates = [];
  const details = {
    language: executor.config.language,
    code: "function solve() { return true; }",
    slug: "two-sum",
    functionName: null,
    parameters: [],
    returnType: null,
    testcases: [
      { input: "case-1", output: "true" },
      { input: "case-2", output: "true" },
    ],
  };

  const execute = createExecutionExecutor(
    executor.config,
    createDependencies(details, updates),
  );
  const result = await execute({
    id: `${name}-job`,
    data: { submissionId: `${name}-submission` },
  });

  assert.strictEqual(result.verdict, "Accepted");
  assert.strictEqual(result.passed, 2);
  assert.strictEqual(result.total, 2);
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].result.status, "completed");

  const sandbox = FakeSandbox.instances[FakeSandbox.instances.length - 1];
  assert.strictEqual(sandbox.options.image, executor.config.image);
  assert.deepStrictEqual(
    sandbox.commands.filter((command) => command.type === "run")[0].command,
    expectedCommand,
  );
  assert.strictEqual(sandbox.started, true);
  assert.strictEqual(sandbox.destroyed, true);
}

async function runTests() {
  assert.strictEqual(compareOutputs("[1, 2]", "[1,2]"), true);
  assert.strictEqual(compareOutputs("false", "False"), true);

  await testLanguageExecutor(
    "javascript",
    jsExecutor,
    ["node", "app.js"],
  );
  await testLanguageExecutor("java", javaExecutor, ["java", "Main"]);

  const javaSandbox = FakeSandbox.instances[FakeSandbox.instances.length - 1];
  assert.deepStrictEqual(
    javaSandbox.commands.find((command) => command.type === "exec").command,
    ["javac", "Main.java"],
  );

  console.log("✓ Shared execution engine works with JavaScript and Java configurations");
}

runTests().catch((error) => {
  console.error("Execution-engine regression test failed:", error);
  process.exit(1);
});
