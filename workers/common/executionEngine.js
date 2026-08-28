const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const {
  getQuestionDetails,
  updateSubmission,
} = require("@koder/shared");
const createSandbox = require("./createSandbox");
const cleanupSandbox = require("./cleanupSandbox");
const DockerSandbox = require("./dockerSandbox");

const PER_TESTCASE_TIMEOUT_MS = 2000;
const OVERALL_SUBMISSION_TIMEOUT_MS = 45000;
const DEFAULT_BATCH_SIZE = 50;
const MAX_OUTPUT_BUFFER_BYTES = 5 * 1024 * 1024;

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

  const arrActual = normActual
    .replace(/^[\[\(\{]|[\]\)\}]$/g, "")
    .split(/[,\s]+/)
    .filter(Boolean);
  const arrExpected = normExpected
    .replace(/^[\[\(\{]|[\]\)\}]$/g, "")
    .split(/[,\s]+/)
    .filter(Boolean);

  return (
    arrActual.length > 0 &&
    arrActual.length === arrExpected.length &&
    arrActual.every((value, index) => value === arrExpected[index])
  );
}

function buildSource(details, config) {
  const {
    code,
    slug,
    functionName,
    parameters,
    returnType,
  } = details;

  if (functionName && parameters && parameters.length > 0) {
    return config.generateRunner(
      { functionName, parameters, returnType, slug },
      code,
    );
  }

  const templatePath = path.resolve(
    config.templateDirectory,
    `${slug}.${config.templateExtension}`,
  );

  if (fs.existsSync(templatePath)) {
    const template = fs.readFileSync(templatePath, "utf8");
    return template.replace("/***USER_CODE***/", code);
  }

  if (functionName) {
    return config.generateRunner(
      { functionName, parameters: parameters || [], returnType, slug },
      code,
    );
  }

  throw new Error(`Template not found for problem slug: ${slug}`);
}

function failureResult({
  verdict,
  passed,
  total,
  totalRuntime,
  maxRuntime,
  failedTestCase,
  errorMessage,
}) {
  return {
    status: "completed",
    verdict,
    passed,
    total,
    totalRuntime: Math.round(totalRuntime),
    maxRuntime: Math.round(maxRuntime),
    memory: 0,
    failedTestCase,
    errorMessage,
  };
}

function createExecutionExecutor(config, dependencies = {}) {
  const loadDetails = dependencies.getQuestionDetails || getQuestionDetails;
  const saveSubmission = dependencies.updateSubmission || updateSubmission;
  const makeSandboxDirectory = dependencies.createSandbox || createSandbox;
  const removeSandboxDirectory = dependencies.cleanupSandbox || cleanupSandbox;
  const Sandbox = dependencies.DockerSandbox || DockerSandbox;

  return async function executeSubmission(job) {
    const { submissionId } = job.data;
    const details = await loadDetails(submissionId);

    if (details.language !== config.language) {
      throw new Error(`Unsupported language for ${config.language} worker`);
    }

    const jobDir = makeSandboxDirectory(job.id);
    const sourcePath = path.join(jobDir, config.sourceFile);
    const sandbox = new Sandbox({
      jobId: job.id,
      jobDir,
      image: config.image,
      readOnly: config.readOnly,
      user: config.user,
    });

    const testcases = details.testcases || [];
    const total = testcases.length;
    let passed = 0;
    let totalRuntime = 0;
    let maxRuntime = 0;
    let result = null;

    try {
      fs.writeFileSync(sourcePath, buildSource(details, config), "utf8");
      await sandbox.start();

      if (config.compile) {
        const compilation = await sandbox.exec(config.compile.command, {
          timeoutMs: config.compile.timeoutMs,
          maxBuffer: MAX_OUTPUT_BUFFER_BYTES,
        });

        if (compilation.timedOut || compilation.code !== 0) {
          result = failureResult({
            verdict: compilation.timedOut
              ? "Time Limit Exceeded"
              : "Compilation Error",
            passed: 0,
            total,
            totalRuntime: compilation.runtimeMs,
            maxRuntime: compilation.runtimeMs,
            failedTestCase: null,
            errorMessage:
              compilation.stderr ||
              compilation.stdout ||
              (compilation.timedOut
                ? "Compilation timed out"
                : "Compilation failed"),
          });
          return await saveSubmission(submissionId, result);
        }
      }

      const submissionDeadline = Date.now() + OVERALL_SUBMISSION_TIMEOUT_MS;
      const batchSize = Math.max(1, DEFAULT_BATCH_SIZE);

      for (let i = 0; i < total; i += batchSize) {
        if (Date.now() >= submissionDeadline) {
          result = failureResult({
            verdict: "Time Limit Exceeded",
            passed,
            total,
            totalRuntime,
            maxRuntime,
            failedTestCase: {
              input: testcases[i].input,
              expected: testcases[i].output,
            },
            errorMessage: "Overall submission execution time limit exceeded",
          });
          break;
        }

        const currentBatch = testcases
          .slice(i, i + batchSize)
          .map((testcase, index) => ({
            id: i + index,
            input: testcase.input,
            output: testcase.output,
          }));

        const batchResult = await sandbox.runInteractiveBatch(
          config.execCommand,
          currentBatch,
          {
            perTestTimeoutMs: PER_TESTCASE_TIMEOUT_MS,
            overallDeadline: submissionDeadline,
            maxBuffer: MAX_OUTPUT_BUFFER_BYTES,
          },
        );

        for (const testcase of currentBatch) {
          if (batchResult.timedOutTestCaseId === testcase.id) {
            result = failureResult({
              verdict: "Time Limit Exceeded",
              passed,
              total,
              totalRuntime,
              maxRuntime,
              failedTestCase: {
                input: testcase.input,
                expected: testcase.output,
              },
              errorMessage: batchResult.overallTimedOut
                ? "Overall submission execution time limit exceeded"
                : "Time Limit Exceeded",
            });
            break;
          }

          if (
            batchResult.crashedTestCaseId === testcase.id &&
            !batchResult.results.has(testcase.id)
          ) {
            result = failureResult({
              verdict: "Runtime Error",
              passed,
              total,
              totalRuntime,
              maxRuntime,
              failedTestCase: {
                input: testcase.input,
                expected: testcase.output,
              },
              errorMessage:
                batchResult.stderr || "Process exited unexpectedly",
            });
            break;
          }

          const testcaseResult = batchResult.results.get(testcase.id);
          if (!testcaseResult) {
            result = failureResult({
              verdict: "Runtime Error",
              passed,
              total,
              totalRuntime,
              maxRuntime,
              failedTestCase: {
                input: testcase.input,
                expected: testcase.output,
              },
              errorMessage: "No response received for test case",
            });
            break;
          }

          totalRuntime += testcaseResult.runtimeMs;
          maxRuntime = Math.max(maxRuntime, testcaseResult.runtimeMs);

          if (testcaseResult.status !== "OK") {
            result = failureResult({
              verdict: "Runtime Error",
              passed,
              total,
              totalRuntime,
              maxRuntime,
              failedTestCase: {
                input: testcase.input,
                expected: testcase.output,
              },
              errorMessage: testcaseResult.error || "Runtime Error",
            });
            break;
          }

          if (!compareOutputs(testcaseResult.output, testcase.output)) {
            result = failureResult({
              verdict: "Wrong Answer",
              passed,
              total,
              totalRuntime,
              maxRuntime,
              failedTestCase: {
                input: testcase.input,
                expected: testcase.output,
                received: (testcaseResult.output || "").trim(),
              },
              errorMessage: null,
            });
            break;
          }

          passed++;
        }

        if (result) break;
      }

      if (!result) {
        result = failureResult({
          verdict: "Accepted",
          passed,
          total,
          totalRuntime,
          maxRuntime,
          failedTestCase: null,
          errorMessage: null,
        });
      }

      return await saveSubmission(submissionId, result);
    } finally {
      await sandbox.destroy();
      removeSandboxDirectory(jobDir);
    }
  };
}

module.exports = {
  compareOutputs,
  buildSource,
  createExecutionExecutor,
};
