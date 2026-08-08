const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

const { getQuestionDetails } = require("../../backend/db_calls/getDetails");
const createSandbox = require("../common/createSandbox");
const cleanupSandbox = require("../common/cleanupSandbox");
const runCode = require("./runCode");
const updateSubmission = require("../../backend/db_calls/updateSubmission");

async function executor(job) {
  const { submissionId } = job.data;

  const { language, code, testcases, slug } =
    await getQuestionDetails(submissionId);

  if (language !== "javascript") {
    throw new Error("Unsupported language");
  }

  const jobDir = createSandbox(job.id);

  const jsFile = path.join(jobDir, "main.js");
  const inputFile = path.join(jobDir, "input.txt");

  const total = testcases.length;
  let passed = 0;
  let totalRuntime = 0;
  let maxRuntime = 0;
  let result = null;

  try {
    const template = fs.readFileSync(
      path.join(__dirname, "templates/javascript", `${slug}.js`),
      "utf8",
    );

    const finalCode = template.replace("/***USER_CODE***/", code);
    fs.writeFileSync(jsFile, finalCode, "utf8");

    for (const testcase of testcases) {
      // Create / overwrite input.txt for this testcase
      fs.writeFileSync(inputFile, testcase.input, "utf8");

      const start = performance.now();

      try {
        // runCode will read input.txt and feed it to stdin
        const output = await runCode(jobDir);

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
            memory: 0,
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
          failedTestCase: {
            input: testcase.input,
            expected: testcase.output,
          },
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

    return await updateSubmission(submissionId, result);
  } finally {
    cleanupSandbox(jobDir);
  }
}

module.exports = executor;
