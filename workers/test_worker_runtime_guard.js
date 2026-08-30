const assert = require("assert");
const {
  getWorkerConcurrencyConfig,
  getHostCapacityConfig,
} = require("../packages/shared/config/queues");
const {
  markSubmissionRunning,
  updateSubmission,
} = require("../packages/shared/db/dbCalls");

async function runTests() {
  const previousJs = process.env.KODER_WORKER_CONCURRENCY_JS;
  const previousJava = process.env.KODER_WORKER_CONCURRENCY_JAVA;
  const previousPython = process.env.KODER_WORKER_CONCURRENCY_PYTHON;

  try {
    process.env.KODER_WORKER_CONCURRENCY_JS = "3";
    process.env.KODER_WORKER_CONCURRENCY_JAVA = "2";
    process.env.KODER_WORKER_CONCURRENCY_PYTHON = "4";

    const jsConfig = getWorkerConcurrencyConfig("javascript");
    const javaConfig = getWorkerConcurrencyConfig("java");
    const pythonConfig = getWorkerConcurrencyConfig("python");
    const hostConfig = getHostCapacityConfig();

    assert.strictEqual(jsConfig.language, "javascript");
    assert.strictEqual(jsConfig.concurrency, 3);
    assert.strictEqual(javaConfig.concurrency, 2);
    assert.strictEqual(pythonConfig.concurrency, 4);
    assert.ok(hostConfig.maxActiveJobs >= 1);

    const runningUpdate = await markSubmissionRunning("64e2d5ec5956e8d99d0f1234", {
      SubmissionModel: {
        findOneAndUpdate: async (filter, update, options) => {
          assert.deepStrictEqual(filter, {
            _id: "64e2d5ec5956e8d99d0f1234",
            status: { $ne: "completed" },
          });
          assert.deepStrictEqual(update, { $set: { status: "running" } });
          assert.ok(options && options.new === true);
          return { status: "running" };
        },
      },
    });

    assert.strictEqual(runningUpdate.status, "running");

    const terminalUpdate = await updateSubmission(
      "64e2d5ec5956e8d99d0f1234",
      {
        status: "completed",
        verdict: "Accepted",
        passed: 1,
        total: 1,
        totalRuntime: 10,
        maxRuntime: 10,
        memory: 64,
        failedTestCase: null,
        errorMessage: null,
      },
      {
        SubmissionModel: {
          findOneAndUpdate: async (filter, update) => {
            assert.deepStrictEqual(filter, {
              _id: "64e2d5ec5956e8d99d0f1234",
              status: { $ne: "completed" },
            });
            assert.strictEqual(update.$set.status, "completed");
            return null;
          },
        },
      },
    );

    assert.strictEqual(terminalUpdate, null);
  } finally {
    if (previousJs === undefined) delete process.env.KODER_WORKER_CONCURRENCY_JS;
    else process.env.KODER_WORKER_CONCURRENCY_JS = previousJs;

    if (previousJava === undefined) delete process.env.KODER_WORKER_CONCURRENCY_JAVA;
    else process.env.KODER_WORKER_CONCURRENCY_JAVA = previousJava;

    if (previousPython === undefined) delete process.env.KODER_WORKER_CONCURRENCY_PYTHON;
    else process.env.KODER_WORKER_CONCURRENCY_PYTHON = previousPython;
  }

  console.log("Worker runtime guard tests passed");
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
