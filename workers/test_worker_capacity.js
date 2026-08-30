const assert = require("assert");
const os = require("os");
const { performance } = require("perf_hooks");
const { createExecutionExecutor } = require("./common/executionEngine");

const levels = [1, 2, 4, 8];
const results = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakeSandbox {
  constructor({ jobId, jobDir, image }) {
    this.jobId = jobId;
    this.jobDir = jobDir;
    this.image = image;
    this.started = false;
  }

  async start() {
    this.started = true;
    await sleep(12);
  }

  async exec(command, options = {}) {
    await sleep(18);
    return {
      code: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
      runtimeMs: 20,
    };
  }

  async runInteractiveBatch(command, batchTestCases, options = {}) {
    await sleep(28);
    const resultsMap = new Map();
    for (const testcase of batchTestCases) {
      resultsMap.set(testcase.id, {
        id: testcase.id,
        status: "OK",
        output: testcase.output,
        error: null,
        runtimeMs: 30,
      });
    }
    return {
      results: resultsMap,
      timedOutTestCaseId: null,
      overallTimedOut: false,
      crashedTestCaseId: null,
      stderr: "",
    };
  }

  async destroy() {
    await sleep(5);
  }
}

function getSnapshot() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const loadAvg = os.loadavg();
  return {
    memoryUsedRatio: (1 - freeMem / totalMem),
    loadAverage: loadAvg,
  };
}

async function runCase(level) {
  const details = {
    language: "javascript",
    code: "const add = (a,b) => a + b;",
    slug: "sample",
    functionName: "add",
    parameters: ["a", "b"],
    returnType: "number",
    testcases: [
      { input: "1 2", output: "3" },
      { input: "2 3", output: "5" },
      { input: "4 5", output: "9" },
    ],
  };

  const executor = createExecutionExecutor(
    {
      language: "javascript",
      sourceFile: "app.js",
      image: "node:18-alpine",
      readOnly: true,
      user: "1000:1000",
      generateRunner: ({ functionName, parameters, returnType, slug }, code) => `
        const ${functionName} = ${code};
        const input = require('fs').readFileSync(0, 'utf8').trim();
        const [a, b] = input.split(/\\s+/).map(Number);
        process.stdout.write(String(${functionName}(a, b)));
      `,
      templateDirectory: __dirname,
      templateExtension: "js",
    },
    {
      getQuestionDetails: async () => details,
      updateSubmission: async (submissionId, result) => ({ submissionId, result }),
      createSandbox: () => __dirname,
      cleanupSandbox: () => undefined,
      DockerSandbox: FakeSandbox,
    },
  );

  const start = performance.now();
  const snapshotBefore = getSnapshot();
  const tasks = Array.from({ length: level }, (_, index) => executor({ data: { submissionId: `bench-${level}-${index}` } }));
  const taskResults = await Promise.all(tasks);
  const duration = performance.now() - start;
  const snapshotAfter = getSnapshot();

  const jobsPerSecond = level / (duration / 1000);
  const errors = taskResults.filter((item) => item && item.status === "already-completed").length;

  results.push({
    concurrency: level,
    jobs: level,
    avgDurationMs: Math.round(duration / level),
    cpuLoad: snapshotBefore.loadAverage[0] + snapshotAfter.loadAverage[0],
    memoryUsage: Math.round((snapshotAfter.memoryUsedRatio - snapshotBefore.memoryUsedRatio) * 100),
    errors,
    jobsPerSecond: Number(jobsPerSecond.toFixed(2)),
  });

  assert.strictEqual(errors, 0);
}

async function runBenchmarks() {
  for (const level of levels) {
    await runCase(level);
  }

  console.log("Concurrency | Jobs | Avg Duration | CPU Load | Memory Delta | Errors | Jobs/sec");
  console.log("--------------------------------------------------------------------------");
  for (const row of results) {
    console.log(`${row.concurrency} | ${row.jobs} | ${row.avgDurationMs} ms | ${row.cpuLoad.toFixed(2)} | ${row.memoryUsage}% | ${row.errors} | ${row.jobsPerSecond}`);
  }
}

runBenchmarks().catch((error) => {
  console.error(error);
  process.exit(1);
});
