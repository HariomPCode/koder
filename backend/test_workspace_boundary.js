const assert = require("assert");
const fs = require("fs");
const path = require("path");

const shared = require("@koder/shared");

async function runBoundaryTests() {
  console.log("=======================================================================");
  console.log("TESTING WORKSPACE MONOREPO ARCHITECTURE & BOUNDARY (ISSUE-004)");
  console.log("=======================================================================\n");

  let passed = 0;
  let total = 0;

  function test(description, fn) {
    total++;
    try {
      fn();
      console.log(`  ✓ ${total}. ${description}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${total}. ${description}`);
      console.error(`     Error: ${err.message}`);
      throw err;
    }
  }

  // 1. @koder/shared exports inspection
  test("@koder/shared exports all required language definitions and validators", () => {
    assert(Array.isArray(shared.SUPPORTED_LANGUAGES), "SUPPORTED_LANGUAGES must be an array");
    assert.deepStrictEqual(shared.SUPPORTED_LANGUAGES, ["javascript", "java"]);
    assert.strictEqual(typeof shared.isSupportedLanguage, "function");
    assert.strictEqual(typeof shared.normalizeLanguage, "function");
    assert.strictEqual(shared.isSupportedLanguage("javascript"), true);
    assert.strictEqual(shared.isSupportedLanguage("java"), true);
    assert.strictEqual(shared.isSupportedLanguage("python"), false);
    assert.strictEqual(shared.isSupportedLanguage("cpp"), false);
    assert.strictEqual(shared.normalizeLanguage(" JAVASCRIPT "), "javascript");
    assert.strictEqual(shared.normalizeLanguage("java"), "java");
    assert.strictEqual(shared.normalizeLanguage("python"), null);
  });

  // 2. Queue configuration
  test("@koder/shared exports pure queue and job constants", () => {
    assert(shared.QUEUE_NAMES, "QUEUE_NAMES must be exported");
    assert.strictEqual(shared.QUEUE_NAMES.javascript, "js-queue");
    assert.strictEqual(shared.QUEUE_NAMES.java, "java-queue");
    assert.strictEqual(shared.JOB_NAMES.EXECUTE, "execute");
    assert.strictEqual(typeof shared.getRedisConfig, "function");
    const redisConfig = shared.getRedisConfig();
    assert.strictEqual(redisConfig.maxRetriesPerRequest, null);
  });

  // 3. Verdicts and Status constants
  test("@koder/shared exports canonical statuses and verdicts", () => {
    assert(shared.SUBMISSION_STATUS, "SUBMISSION_STATUS must be exported");
    assert.strictEqual(shared.SUBMISSION_STATUS.PENDING, "pending");
    assert.strictEqual(shared.SUBMISSION_STATUS.RUNNING, "running");
    assert.strictEqual(shared.SUBMISSION_STATUS.COMPLETED, "completed");

    assert(shared.JUDGE_VERDICTS, "JUDGE_VERDICTS must be exported");
    assert.strictEqual(shared.JUDGE_VERDICTS.ACCEPTED, "Accepted");
    assert.strictEqual(shared.JUDGE_VERDICTS.WRONG_ANSWER, "Wrong Answer");
    assert.strictEqual(shared.JUDGE_VERDICTS.COMPILATION_ERROR, "Compilation Error");
    assert.strictEqual(shared.JUDGE_VERDICTS.RUNTIME_ERROR, "Runtime Error");
    assert.strictEqual(shared.JUDGE_VERDICTS.TIME_LIMIT_EXCEEDED, "Time Limit Exceeded");
  });

  // 4. BLSP Protocol
  test("@koder/shared exports Base64 Line Streaming Protocol encoder and decoder", () => {
    assert.strictEqual(typeof shared.encodeRequest, "function");
    assert.strictEqual(typeof shared.decodeResponse, "function");

    const encoded = shared.encodeRequest(42, "hello\nworld");
    assert.strictEqual(encoded, "42 aGVsbG8Kd29ybGQ=\n");

    const okLine = "42 OK " + Buffer.from("result_data", "utf8").toString("base64");
    const decodedOk = shared.decodeResponse(okLine);
    assert.deepStrictEqual(decodedOk, {
      caseId: 42,
      status: "OK",
      payload: "result_data",
    });

    const errLine = "42 ERROR " + Buffer.from("runtime exception", "utf8").toString("base64");
    const decodedErr = shared.decodeResponse(errLine);
    assert.deepStrictEqual(decodedErr, {
      caseId: 42,
      status: "ERROR",
      payload: "runtime exception",
    });
  });

  // 5. Template generator
  test("@koder/shared exports code generator functions", () => {
    assert.strictEqual(typeof shared.generateStarterCode, "function");
    assert.strictEqual(typeof shared.generateJavaScriptRunner, "function");
    assert.strictEqual(typeof shared.generateJavaRunner, "function");

    const meta = {
      functionName: "twoSum",
      parameters: [
        { name: "nums", type: "int[]" },
        { name: "target", type: "int" },
      ],
      returnType: "int[]",
    };

    const starter = shared.generateStarterCode(meta);
    assert.strictEqual(starter.length, 2);
    assert.strictEqual(starter[0].language, "javascript");
    assert(starter[0].code.includes("function twoSum(nums, target)"));
    assert.strictEqual(starter[1].language, "java");
    assert(starter[1].code.includes("public int[] twoSum(int[] nums, int target)"));

    const jsRunner = shared.generateJavaScriptRunner(meta, "function twoSum(nums, target) { return [0, 1]; }");
    assert(jsRunner.includes("function parseTestInput"));
    assert(jsRunner.includes("rl.on('line'"));

    const javaRunner = shared.generateJavaRunner(meta, "class Solution { public int[] twoSum(int[] nums, int target) { return new int[]{0, 1}; } }");
    assert(javaRunner.includes("public class Main"));
    assert(javaRunner.includes("class FastScanner"));
  });

  // 6. Shared Mongoose Models & DB calls
  test("@koder/shared exports Question and Submission models and DB access functions", () => {
    assert(shared.Question, "Question model must be exported");
    assert(shared.Submission, "Submission model must be exported");
    assert.strictEqual(typeof shared.getQuestionDetails, "function");
    assert.strictEqual(typeof shared.updateSubmission, "function");
  });

  // 7. Static analysis: Zero worker imports pointing into backend
  test("Workers directory contains ZERO relative imports into backend", () => {
    const workersDir = path.resolve(__dirname, "../workers");
    function scanDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== ".git") {
            scanDir(fullPath);
          }
        } else if (entry.name.endsWith(".js")) {
          const content = fs.readFileSync(fullPath, "utf8");
          const matches = content.match(/require\s*\(\s*["'][^"']*backend[^"']*["']\s*\)/g);
          assert.strictEqual(
            matches,
            null,
            `File ${fullPath} has prohibited import to backend: ${matches ? matches.join(", ") : ""}`
          );
        }
      }
    }
    scanDir(workersDir);
  });

  // 8. Static analysis: Zero backend imports pointing into workers
  test("Backend directory contains ZERO relative imports into workers", () => {
    const backendDir = path.resolve(__dirname, "../backend");
    function scanDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== ".git") {
            scanDir(fullPath);
          }
        } else if (entry.name.endsWith(".js")) {
          const content = fs.readFileSync(fullPath, "utf8");
          const matches = content.match(/require\s*\(\s*["'][^"']*workers[^"']*["']\s*\)/g);
          assert.strictEqual(
            matches,
            null,
            `File ${fullPath} has prohibited import to workers: ${matches ? matches.join(", ") : ""}`
          );
        }
      }
    }
    scanDir(backendDir);
  });

  // 9. Root workspace configuration validation
  test("Root package.json configures npm workspaces correctly", () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
    assert(Array.isArray(rootPkg.workspaces), "workspaces must be an array");
    assert(rootPkg.workspaces.includes("packages/*"), "workspaces must include packages/*");
    assert(rootPkg.workspaces.includes("backend"), "workspaces must include backend");
    assert(rootPkg.workspaces.includes("workers"), "workspaces must include workers");
  });

  // 10. Workers package.json specifies @koder/shared and mongoose
  test("Workers package.json specifies @koder/shared and mongoose dependencies", () => {
    const workersPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../workers/package.json"), "utf8"));
    assert(workersPkg.dependencies["@koder/shared"], "workers must depend on @koder/shared");
    assert(workersPkg.dependencies["mongoose"], "workers must declare mongoose dependency");
  });

  console.log(`\n=======================================================================`);
  console.log(`TEST SUMMARY: ${passed} passed, 0 failed (Total: ${total})`);
  console.log(`=======================================================================\n`);
}

runBoundaryTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});