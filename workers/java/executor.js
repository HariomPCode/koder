const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

const { getQuestionDetails } = require("../../backend/db_calls/getDetails");
const createSandbox = require("../common/createSandbox");
const cleanupSandbox = require("../common/cleanupSandbox");

const compileCode = require("./compileCode");
const runCode = require("./runCode");

const updateSubmission = require("../../backend/db_calls/updateSubmission");

async function executor(job) {
  const { submissionId } = job.data;

  const { language, code, testcases, slug } =
    await getQuestionDetails(submissionId);

  if (language !== "java") {
    throw new Error("Unsupported language for Java worker");
  }

  const jobDir = createSandbox(job.id);

  const javaFile = path.join(jobDir, "Main.java");
  const inputFile = path.join(jobDir, "input.txt");

  // -----------------------------------------
  // CREATE JAVA FILE
  // -----------------------------------------

  try {
    const template = fs.readFileSync(
      path.join(__dirname, "templates/java", `${slug}.java`),
      "utf8",
    );

    const finalCode = template.replace("/***USER_CODE***/", code);

    fs.writeFileSync(javaFile, finalCode, "utf8");

    // -----------------------------------------
    // COMPILE
    // -----------------------------------------

    const compilation = await compileCode(jobDir);

    if (!compilation.success) {
      const result = {
        status: "completed",

        verdict: compilation.timedOut
          ? "Compilation Time Limit Exceeded"
          : "Compilation Error",

        passed: 0,
        total: testcases.length,

        totalRuntime: 0,
        maxRuntime: 0,

        memory: 0,

        failedTestCase: null,

        errorMessage:
          compilation.stderr || compilation.stdout || "Compilation failed",
      };

      return await updateSubmission(submissionId, result);
    }

    console.log("Java compilation successful");

    // -----------------------------------------
    // EXECUTE TESTCASES
    // -----------------------------------------

    const total = testcases.length;

    let passed = 0;
    let totalRuntime = 0;
    let maxRuntime = 0;

    let result = null;

    for (const testcase of testcases) {
      // Write testcase input
      fs.writeFileSync(inputFile, testcase.input, "utf8");

      const start = performance.now();

      try {
        const output = await runCode(jobDir);

        const runtime = performance.now() - start;

        totalRuntime += runtime;

        maxRuntime = Math.max(maxRuntime, runtime);

        const actualOutput = output.trim();

        const expectedOutput = testcase.output.trim();

        // -----------------------------------------
        // WRONG ANSWER
        // -----------------------------------------

        if (actualOutput !== expectedOutput) {
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
              received: actualOutput,
            },

            errorMessage: null,
          };

          break;
        }

        passed++;
      } catch (err) {
        // -----------------------------------------
        // RUNTIME ERROR / TLE
        // -----------------------------------------

        result = {
          status: "completed",

          verdict: err.code === "TLE" ? "Time Limit Exceeded" : "Runtime Error",

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

    // -----------------------------------------
    // ALL TESTCASES PASSED
    // -----------------------------------------

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
    // Always cleanup sandbox
    cleanupSandbox(jobDir);
  }
}

module.exports = executor;
