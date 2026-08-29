const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const pythonExecutor = require("./python/executor");
const { createExecutionExecutor } = require("./common/executionEngine");
const DockerSandbox = require("./common/dockerSandbox");

class TrackingSandbox extends DockerSandbox {
  static instances = [];

  constructor(options) {
    super(options);
    TrackingSandbox.instances.push(this);
  }
}

function dockerExitCode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args);
    child.on("error", reject);
    child.on("close", resolve);
  });
}

function detailsFor(code) {
  return {
    language: "python",
    code,
    slug: "two-sum",
    functionName: "twoSum",
    parameters: [
      { name: "nums", type: "int[]" },
      { name: "target", type: "int" },
    ],
    returnType: "int[]",
    testcases: [{ input: "4\n2 7 11 15\n9", output: "0 1" }],
  };
}

async function executeCase(name, code) {
  return executeDetails(name, detailsFor(code));
}

async function executeDetails(name, details) {
  const updates = [];
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), `koder-python-${name}-`));
  const execute = createExecutionExecutor(pythonExecutor.config, {
    getQuestionDetails: async () => details,
    updateSubmission: async (_id, result) => {
      updates.push(result);
      return result;
    },
    createSandbox: () => jobDir,
    cleanupSandbox: (directory) => fs.rmSync(directory, { recursive: true, force: true }),
    DockerSandbox: TrackingSandbox,
  });

  const result = await execute({ id: `python-${name}`, data: { submissionId: name } });
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(fs.existsSync(jobDir), false, "sandbox directory must be removed");

  const sandbox = TrackingSandbox.instances.at(-1);
  assert.strictEqual(sandbox.isDestroyed, true, "sandbox container must be destroyed");
  assert.strictEqual(
    await dockerExitCode(["inspect", sandbox.containerName]),
    1,
    "destroyed submission container must not remain",
  );
  return result;
}

function booleanDetails(code) {
  return {
    language: "python",
    code,
    slug: "python-boolean-regression",
    functionName: "check",
    parameters: [{ name: "s", type: "String" }],
    returnType: "boolean",
    testcases: [
      { input: "racecar", output: "true" },
      { input: "hello", output: "false" },
    ],
  };
}

async function testSecurity() {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), "koder-python-security-"));
  const sandbox = new DockerSandbox({
    jobId: "python-security",
    jobDir,
    image: pythonExecutor.config.image,
    readOnly: pythonExecutor.config.readOnly,
    user: pythonExecutor.config.user,
  });

  try {
    await sandbox.start();
    const security = await sandbox.exec([
      "sh",
      "-c",
      "test \"$(id -u)\" = 1000 && test ! -w / && test ! -w /etc && test -w /app && test -w /tmp && test \"$(ls /sys/class/net)\" = lo",
    ]);
    assert.strictEqual(security.code, 0, security.stderr || "sandbox security check failed");
  } finally {
    await sandbox.destroy();
    fs.rmSync(jobDir, { recursive: true, force: true });
  }

  assert.strictEqual(await dockerExitCode(["inspect", sandbox.containerName]), 1);
}

async function runTests() {
  const accepted = await executeCase(
    "accepted",
    "class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, value in enumerate(nums):\n            if target - value in seen:\n                return [seen[target - value], i]\n            seen[value] = i",
  );
  assert.strictEqual(accepted.verdict, "Accepted");

  const wrongAnswer = await executeCase(
    "wrong-answer",
    "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 0]",
  );
  assert.strictEqual(wrongAnswer.verdict, "Wrong Answer");

  const timeLimit = await executeCase(
    "time-limit",
    "class Solution:\n    def twoSum(self, nums, target):\n        while True:\n            pass",
  );
  assert.strictEqual(timeLimit.verdict, "Time Limit Exceeded");

  const runtimeError = await executeCase(
    "runtime-error",
    "class Solution:\n    def twoSum(self, nums, target):\n        raise RuntimeError('boom')",
  );
  assert.strictEqual(runtimeError.verdict, "Runtime Error");

  const booleanByInput = await executeDetails(
    "boolean-multiple-cases",
    booleanDetails(
      "class Solution:\n    def check(self, s):\n        return s == 'racecar'",
    ),
  );
  assert.strictEqual(booleanByInput.verdict, "Accepted");
  assert.strictEqual(booleanByInput.passed, 2);

  const alwaysTrue = await executeDetails(
    "boolean-always-true",
    booleanDetails(
      "class Solution:\n    def check(self, s):\n        return True",
    ),
  );
  assert.strictEqual(alwaysTrue.verdict, "Wrong Answer");
  assert.strictEqual(alwaysTrue.passed, 1);

  const alwaysFalse = await executeDetails(
    "boolean-always-false",
    booleanDetails(
      "class Solution:\n    def check(self, s):\n        return False",
    ),
  );
  assert.strictEqual(alwaysFalse.verdict, "Wrong Answer");
  assert.strictEqual(alwaysFalse.passed, 0);

  const nonBooleanMultipleCases = await executeDetails("integer-multiple-cases", {
    language: "python",
    code: "class Solution:\n    def length(self, s):\n        return len(s)",
    slug: "python-integer-regression",
    functionName: "length",
    parameters: [{ name: "s", type: "String" }],
    returnType: "int",
    testcases: [
      { input: "racecar", output: "7" },
      { input: "hello", output: "5" },
    ],
  });
  assert.strictEqual(nonBooleanMultipleCases.verdict, "Accepted");
  assert.strictEqual(nonBooleanMultipleCases.passed, 2);

  await testSecurity();
  console.log("✓ Python Docker: Accepted, Wrong Answer, TLE, Runtime Error, security, and cleanup verified");
}

runTests().catch((error) => {
  console.error("Python Docker integration test failed:", error);
  process.exit(1);
});
