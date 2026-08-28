const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const workerFactoryPath = require.resolve("./common/workerFactory");
const workerRegistrations = [];
require.cache[workerFactoryPath] = {
  id: workerFactoryPath,
  filename: workerFactoryPath,
  loaded: true,
  exports: (queueName, processor) => {
    workerRegistrations.push({ queueName, processor });
  },
};

const jsExecutor = require("./javascript/executor");
const javaExecutor = require("./java/executor");
require("./javascript/worker");
require("./java/worker");
const {
  createExecutionExecutor,
  compareOutputs,
} = require("./common/executionEngine");
const DockerSandbox = require("./common/dockerSandbox");

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
  assert.strictEqual(sandbox.options.readOnly, true);
  assert.strictEqual(sandbox.options.user, "1000:1000");
  assert.deepStrictEqual(
    sandbox.commands.filter((command) => command.type === "run")[0].command,
    expectedCommand,
  );
  assert.strictEqual(sandbox.started, true);
  assert.strictEqual(sandbox.destroyed, true);
}

async function runTests() {
  assert.deepStrictEqual(
    workerRegistrations.map((registration) => registration.queueName),
    ["js-queue", "java-queue"],
  );
  assert.strictEqual(typeof workerRegistrations[0].processor, "function");
  assert.strictEqual(typeof workerRegistrations[1].processor, "function");

  for (const config of [jsExecutor.config, javaExecutor.config]) {
    const sandbox = new DockerSandbox({
      jobId: `args-${config.language}`,
      jobDir: "C:\\sandbox\\job",
      image: config.image,
      readOnly: config.readOnly,
      user: config.user,
    });
    const dockerArgs = sandbox.buildDockerRunArgs();
    assert.ok(dockerArgs.includes("--read-only"));
    assert.deepStrictEqual(
      dockerArgs.slice(dockerArgs.indexOf("--user"), dockerArgs.indexOf("--user") + 2),
      ["--user", "1000:1000"],
    );
    assert.ok(dockerArgs.includes("--cap-drop"));
    assert.ok(dockerArgs.includes("ALL"));
    assert.ok(dockerArgs.includes("--network"));
    assert.ok(dockerArgs.includes("none"));
    assert.ok(dockerArgs.includes("--security-opt"));
    assert.ok(dockerArgs.includes("no-new-privileges"));
    assert.ok(dockerArgs.includes("-v"));
    assert.ok(dockerArgs.includes("C:/sandbox/job:/app"));
  }

  const candidateFiles = [
    "common/runDocker.js",
    "javascript/runCode.js",
    "java/runCode.js",
    "java/compileCode.js",
  ];
  for (const candidate of candidateFiles) {
    assert.strictEqual(
      fs.existsSync(path.join(__dirname, candidate)),
      false,
      `${candidate} should be removed`,
    );
  }

  for (const directory of ["common", "javascript", "java"]) {
    const directoryPath = path.join(__dirname, directory);
    for (const filename of fs.readdirSync(directoryPath)) {
      if (!filename.endsWith(".js") || filename.startsWith("test")) continue;
      const source = fs.readFileSync(path.join(directoryPath, filename), "utf8");
      assert.ok(
        !/(runDocker|runCode|compileCode)/.test(source),
        `${directory}/${filename} references removed execution helpers`,
      );
    }
  }

  assert.strictEqual(compareOutputs("[1, 2]", "[1,2]"), true);
  assert.strictEqual(compareOutputs("false", "False"), true);

  await testLanguageExecutor(
    "javascript",
    jsExecutor,
    ["node", "app.js"],
  );
  await testLanguageExecutor("java", javaExecutor, ["java", "Main"]);

  const javaSandbox = FakeSandbox.instances[FakeSandbox.instances.length - 1];
  assert.strictEqual(javaExecutor.config.readOnly, true);
  assert.strictEqual(javaExecutor.config.user, "1000:1000");
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
