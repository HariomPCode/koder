const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const jsExecutor = require("./javascript/executor");
const javaExecutor = require("./java/executor");
const pythonExecutor = require("./python/executor");
const { createExecutionExecutor } = require("./common/executionEngine");
const DockerSandbox = require("./common/dockerSandbox");
const createSandbox = require("./common/createSandbox");

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

function detailsFor(language) {
  const code = {
    javascript: "function twoSum(nums, target) { return [0, 1]; }",
    java: "class Solution { public int[] twoSum(int[] nums, int target) { return new int[]{0, 1}; } }",
    python: "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]",
  }[language];

  return {
    language,
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

async function runTests() {
  const executors = [jsExecutor, javaExecutor, pythonExecutor];
  const updates = [];
  const executions = executors.map((executor) => {
    const execute = createExecutionExecutor(executor.config, {
      getQuestionDetails: async () => detailsFor(executor.config.language),
      updateSubmission: async (_id, result) => {
        updates.push(result);
        return result;
      },
      DockerSandbox: TrackingSandbox,
    });
    return execute({
      id: "1",
      data: { submissionId: `${executor.config.language}-collision` },
    });
  });

  const results = await Promise.all(executions);
  assert.deepStrictEqual(results.map((result) => result.verdict), [
    "Accepted",
    "Accepted",
    "Accepted",
  ]);
  assert.strictEqual(updates.length, 3);

  const directories = TrackingSandbox.instances.map((sandbox) => sandbox.jobDir);
  assert.strictEqual(new Set(directories).size, 3);
  assert.deepStrictEqual(
    directories.map((directory) => path.basename(directory)).sort(),
    ["javascript-1", "java-1", "python-1"].sort(),
  );

  for (const sandbox of TrackingSandbox.instances) {
    assert.strictEqual(sandbox.isDestroyed, true);
    assert.strictEqual(fs.existsSync(sandbox.jobDir), false);
    assert.strictEqual(
      await dockerExitCode(["inspect", sandbox.containerName]),
      1,
      `container ${sandbox.containerName} should be removed`,
    );
  }

  assert.strictEqual(fs.existsSync(createSandbox.SANDBOX_ROOT), true);
  console.log("✓ Concurrent JS, Java, and Python jobs with ID 1 used isolated Docker /app mounts and cleaned up");
}

runTests().catch((error) => {
  console.error("Sandbox collision Docker integration test failed:", error);
  process.exit(1);
});
