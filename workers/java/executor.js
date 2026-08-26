const fs = require("fs");
const path = require("path");

const { getQuestionDetails } = require("../../backend/db_calls/getDetails");
const createSandbox = require("../common/createSandbox");
const cleanupSandbox = require("../common/cleanupSandbox");
const DockerSandbox = require("../common/dockerSandbox");
const updateSubmission = require("../../backend/db_calls/updateSubmission");
const { generateJavaRunner } = require("../common/templateGenerator");

// Execution configuration constants
const COMPILATION_TIMEOUT_MS = 25000;
const PER_TESTCASE_TIMEOUT_MS = 2000;
const OVERALL_SUBMISSION_TIMEOUT_MS = 45000;
const DEFAULT_BATCH_SIZE = 50; // Balance between speed and bounded state isolation
const MAX_OUTPUT_BUFFER_BYTES = 5 * 1024 * 1024; // 5 MB

function compareOutputs(actual, expected) {
  if (actual === expected) return true;
  const normActual = (actual || "").trim().replace(/\r\n/g, "\n");
  const normExpected = (expected || "").trim().replace(/\r\n/g, "\n");
  if (normActual === normExpected) return true;

  try {
    const jsonActual = JSON.parse(normActual);
    const jsonExpected = JSON.parse(normExpected);
    if (JSON.stringify(jsonActual) === JSON.stringify(jsonExpected)) return true;
  } catch (_) {}

  if (
    normActual.toLowerCase() === normExpected.toLowerCase() &&
    (normActual.toLowerCase() === "true" || normActual.toLowerCase() === "false")
  ) {
    return true;
  }

  const arrActual = normActual.replace(/^[\[\(\{]|[\]\)\}]$/g, "").split(/[,\s]+/).filter(Boolean);
  const arrExpected = normExpected.replace(/^[\[\(\{]|[\]\)\}]$/g, "").split(/[,\s]+/).filter(Boolean);
  if (arrActual.length > 0 && arrActual.length === arrExpected.length) {
    if (arrActual.every((val, idx) => val === arrExpected[idx])) {
      return true;
    }
  }

  return false;
}

async function executor(job) {
  const { submissionId } = job.data;

  const { language, code, testcases, slug, functionName, parameters, returnType } =
    await getQuestionDetails(submissionId);

  if (language !== "java") {
    throw new Error("Unsupported language for Java worker");
  }

  const jobDir = createSandbox(job.id);
  const javaFile = path.join(jobDir, "Main.java");

  const total = testcases ? testcases.length : 0;
  let passed = 0;
  let totalRuntime = 0;
  let maxRuntime = 0;
  let result = null;

  // Single Docker sandbox container for this entire Java submission
  const sandbox = new DockerSandbox({
    jobId: job.id,
    jobDir,
    image: "eclipse-temurin:17-jdk-alpine-3.23",
    readOnly: false, // Java compiler needs to write Main.class to /app
  });

  try {
    let finalCode = "";

    if (functionName && parameters && parameters.length > 0) {
      finalCode = generateJavaRunner(
        { functionName, parameters, returnType, slug },
        code,
      );
    } else {
      const templatePath = path.resolve(
        __dirname,
        "../templates/java",
        `${slug}.java`,
      );

      if (fs.existsSync(templatePath)) {
        const template = fs.readFileSync(templatePath, "utf8");
        finalCode = template.replace("/***USER_CODE***/", code);
      } else if (functionName) {
        finalCode = generateJavaRunner(
          { functionName, parameters: parameters || [], returnType, slug },
          code,
        );
      } else {
        throw new Error(`Template not found for problem slug: ${slug}`);
      }
    }

    fs.writeFileSync(javaFile, finalCode, "utf8");

    // Start ONE isolated Docker container for the entire submission
    await sandbox.start();

    // -------------------------------------------------------------
    // 1. COMPILE ONCE inside the sandbox
    // -------------------------------------------------------------
    const compilation = await sandbox.exec(["javac", "Main.java"], {
      timeoutMs: COMPILATION_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BUFFER_BYTES,
    });

    if (compilation.timedOut || compilation.code !== 0) {
      const isTLE = compilation.timedOut;
      result = {
        status: "completed",
        verdict: isTLE ? "Time Limit Exceeded" : "Compilation Error",
        passed: 0,
        total,
        totalRuntime: Math.round(compilation.runtimeMs),
        maxRuntime: Math.round(compilation.runtimeMs),
        memory: 0,
        failedTestCase: null,
        errorMessage:
          compilation.stderr ||
          compilation.stdout ||
          (isTLE ? "Compilation timed out" : "Compilation failed"),
      };

      return await updateSubmission(submissionId, result);
    }

    // -------------------------------------------------------------
    // 2. EXECUTE TESTCASES in streaming batches with per-test watchdogs
    // -------------------------------------------------------------
    const submissionDeadline = Date.now() + OVERALL_SUBMISSION_TIMEOUT_MS;
    const batchSize = Math.max(1, DEFAULT_BATCH_SIZE);

    for (let i = 0; i < total; i += batchSize) {
      if (Date.now() >= submissionDeadline) {
        result = {
          status: "completed",
          verdict: "Time Limit Exceeded",
          passed,
          total,
          totalRuntime: Math.round(totalRuntime),
          maxRuntime: Math.round(maxRuntime),
          memory: 0,
          failedTestCase: {
            input: testcases[i].input,
            expected: testcases[i].output,
          },
          errorMessage: "Overall submission execution time limit exceeded",
        };
        break;
      }

      const currentBatch = testcases.slice(i, i + batchSize).map((tc, idx) => ({
        id: i + idx,
        input: tc.input,
        output: tc.output,
      }));

      // Execute interactive streaming batch inside the existing sandbox container
      const batchResult = await sandbox.runInteractiveBatch(
        ["java", "Main"],
        currentBatch,
        {
          perTestTimeoutMs: PER_TESTCASE_TIMEOUT_MS,
          overallDeadline: submissionDeadline,
          maxBuffer: MAX_OUTPUT_BUFFER_BYTES,
        },
      );

      // Evaluate each testcase in the batch in order
      for (let j = 0; j < currentBatch.length; j++) {
        const tc = currentBatch[j];

        // 1. Time Limit Exceeded on this test case
        if (batchResult.timedOutTestCaseId === tc.id) {
          result = {
            status: "completed",
            verdict: "Time Limit Exceeded",
            passed,
            total,
            totalRuntime: Math.round(totalRuntime),
            maxRuntime: Math.round(maxRuntime),
            memory: 0,
            failedTestCase: {
              input: tc.input,
              expected: tc.output,
            },
            errorMessage: batchResult.overallTimedOut
              ? "Overall submission execution time limit exceeded"
              : "Time Limit Exceeded",
          };
          break;
        }

        // 2. Process crashed or exited unexpectedly on this testcase
        if (batchResult.crashedTestCaseId === tc.id && !batchResult.results.has(tc.id)) {
          result = {
            status: "completed",
            verdict: "Runtime Error",
            passed,
            total,
            totalRuntime: Math.round(totalRuntime),
            maxRuntime: Math.round(maxRuntime),
            memory: 0,
            failedTestCase: {
              input: tc.input,
              expected: tc.output,
            },
            errorMessage: batchResult.stderr || "Process exited unexpectedly",
          };
          break;
        }

        const tcRes = batchResult.results.get(tc.id);
        if (!tcRes) {
          result = {
            status: "completed",
            verdict: "Runtime Error",
            passed,
            total,
            totalRuntime: Math.round(totalRuntime),
            maxRuntime: Math.round(maxRuntime),
            memory: 0,
            failedTestCase: {
              input: tc.input,
              expected: tc.output,
            },
            errorMessage: "No response received for test case",
          };
          break;
        }

        totalRuntime += tcRes.runtimeMs;
        maxRuntime = Math.max(maxRuntime, tcRes.runtimeMs);

        // 3. User runtime exception or fatal JVM error
        if (tcRes.status !== "OK") {
          result = {
            status: "completed",
            verdict: tcRes.status === "FATAL_ERROR" ? "Runtime Error" : "Runtime Error",
            passed,
            total,
            totalRuntime: Math.round(totalRuntime),
            maxRuntime: Math.round(maxRuntime),
            memory: 0,
            failedTestCase: {
              input: tc.input,
              expected: tc.output,
            },
            errorMessage: tcRes.error || "Runtime Error",
          };
          break;
        }

        // 4. Output validation
        const actualOutput = tcRes.output || "";
        const expectedOutput = tc.output || "";

        if (!compareOutputs(actualOutput, expectedOutput)) {
          result = {
            status: "completed",
            verdict: "Wrong Answer",
            passed,
            total,
            totalRuntime: Math.round(totalRuntime),
            maxRuntime: Math.round(maxRuntime),
            memory: 0,
            failedTestCase: {
              input: tc.input,
              expected: tc.output,
              received: tcRes.output.trim(),
            },
            errorMessage: null,
          };
          break;
        }

        passed++;
      }

      // If any failure occurred in this batch, stop processing further batches
      if (result) {
        break;
      }
    }

    // All testcases passed
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
    // Always cleanly destroy the Docker container and remove temp workspace
    await sandbox.destroy();
    cleanupSandbox(jobDir);
  }
}

module.exports = executor;
