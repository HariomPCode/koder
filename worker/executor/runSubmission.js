const { performance } = require("perf_hooks");

const { getQuestionDetails } = require("../../backend/db_calls/getDetails");
const createSandBox = require("./createSandBox");
const runCode = require("./runCode");
const cleanupSandbox = require("./cleanupSandbox");
const updateSubmission = require("../../backend/db_calls/updateSubmission");

async function runSubmission(job) {
  const { submissionId } = job.data;

  const { language, code, testcases } = await getQuestionDetails(submissionId);

  if (language !== "js") {
    throw new Error("Unsupported language");
  }

  const { jobDir, dockerArgs } = createSandBox(job.id, code);

  const total = testcases.length;
  let passed = 0;
  let totalRuntime = 0;
  let maxRuntime = 0;
  let result;

  try {
    for (const testcase of testcases) {
      const start = performance.now();

      try {
        const output = await runCode(testcase.input, dockerArgs);

        const runtime = performance.now() - start;

        totalRuntime += runtime;
        maxRuntime = Math.max(maxRuntime, runtime);

        if (output.trim() !== testcase.output.trim()) {
          result = {
            status: "completed",
            verdict: "Wrong Answer",
            passed,
            total,
            totalRuntime: Math.round(totalRuntime),
            maxRuntime: Math.round(maxRuntime),
            memory: 0, //unable to calculate now
            failedTestCase: {
              input: testcase.input,
              expected: testcase.output,
              received: output.trim(),
            },
            errorMessage: null,
          };

          break;
        }

        passed++;
      } catch (err) {
        result = {
          status: "completed",
          verdict: "Runtime Error",
          passed,
          total,
          totalRuntime: Math.round(totalRuntime),
          maxRuntime: Math.round(maxRuntime),
          memory: 0,
          failedTestCase: testcase,
          errorMessage: err.message,
        };

        break;
      }
    }

    if (!result) {
      result = {
        status: "completed",
        verdict: "Accepted",
        passed,
        total,
        totalRuntime: Math.round(totalRuntime),
        maxRuntime: Math.round(maxRuntime),
        memory: 0,
        failedTestCase: null,
        errorMessage: null,
      };
    }

    const submission = await updateSubmission(submissionId, result);

    return submission;
  } finally {
    cleanupSandbox(jobDir);
  }
}

module.exports = runSubmission;
