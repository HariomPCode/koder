const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Set environment for test
process.env.JWT_SECRET = "test-secret-key-12345";
process.env.NODE_ENV = "test";

const queuedJobs = {
  javascript: [],
  java: [],
};

// Mock queue before loading routes so it doesn't open live redis connection
const queuePath = require.resolve("./queue");
require.cache[queuePath] = {
  id: queuePath,
  filename: queuePath,
  loaded: true,
  exports: {
    connection: { quit: async () => {}, disconnect: () => {} },
    jsQueue: {
      add: async function (name, data) {
        queuedJobs.javascript.push({ name, data });
        return { id: `js-job-${queuedJobs.javascript.length}` };
      },
    },
    javaQueue: {
      add: async function (name, data) {
        queuedJobs.java.push({ name, data });
        return { id: `java-job-${queuedJobs.java.length}` };
      },
    },
  },
};

const {
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  normalizeLanguage,
} = require("./config/languages");
const Submission = require("./models/Submission");
const Question = require("./models/Question");
const User = require("./models/User");
const submissionRoute = require("./routes/submission.route");
const adminRoute = require("./routes/admin.route");
const { generateStarterCode } = require("../workers/common/templateGenerator");

async function runTests() {
  console.log("=======================================================================");
  console.log("TESTING LANGUAGE CONTRACT CONSISTENCY (ISSUE-003)");
  console.log("=======================================================================\n");

  // In-memory test state
  const mockUser = new User({
    _id: "60c72b2f9b1d8b0015f8e001",
    firstName: "Test",
    lastName: "User",
    email: "user@test.com",
    role: "user",
  });

  const mockAdmin = new User({
    _id: "60c72b2f9b1d8b0015f8e002",
    firstName: "Admin",
    lastName: "Master",
    email: "admin@test.com",
    role: "admin",
  });

  const mockQuestion = {
    _id: "60c72b2f9b1d8b0015f8e010",
    questionNum: 1,
    title: "Two Sum",
    slug: "two-sum",
    difficulty: "Easy",
    description: "Two sum problem description",
    starterCode: [
      { language: "javascript", code: "function twoSum() {}" },
      { language: "java", code: "class Solution {}" },
    ],
  };

  const createdSubmissions = [];

  // Mock Submission.create
  Submission.create = async function (data) {
    const sub = new Submission({
      _id: `60c72b2f9b1d8b0015f8e09${createdSubmissions.length}`,
      ...data,
    });
    await sub.validate();
    createdSubmissions.push(sub);
    return sub;
  };

  // Mock Question queries
  Question.findById = async function (id) {
    if (id === mockQuestion._id) return mockQuestion;
    return null;
  };

  Question.findOne = function () {
    return {
      sort: async function () {
        return mockQuestion;
      },
    };
  };

  let capturedAdminQuestion = null;
  Question.create = async function (data) {
    capturedAdminQuestion = data;
    return { _id: "60c72b2f9b1d8b0015f8e099", ...data };
  };

  Question.findByIdAndUpdate = async function (id, data) {
    capturedAdminQuestion = data;
    return { _id: id, ...mockQuestion, ...data };
  };

  // Create Express test app
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/v1/submissions", submissionRoute);
  app.use("/admin", adminRoute);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  const userToken = jwt.sign(
    { userId: mockUser._id },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  const adminToken = jwt.sign(
    { userId: mockAdmin._id },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  // Mock User.findById for adminMiddleware
  User.findById = function (id) {
    const targetId = typeof id === "object" && id._id ? id._id.toString() : id.toString();
    if (targetId === mockAdmin._id.toString()) return Promise.resolve(mockAdmin);
    if (targetId === mockUser._id.toString()) return Promise.resolve(mockUser);
    return Promise.resolve(null);
  };

  let passed = 0;
  let failed = 0;

  async function testCase(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  }

  try {
    // 1. Source of truth configuration
    await testCase("1. SUPPORTED_LANGUAGES contains exactly ['javascript', 'java']", async () => {
      assert.deepStrictEqual([...SUPPORTED_LANGUAGES], ["javascript", "java"]);
      assert.strictEqual(isSupportedLanguage("javascript"), true);
      assert.strictEqual(isSupportedLanguage("JAVASCRIPT"), true);
      assert.strictEqual(isSupportedLanguage("java"), true);
      assert.strictEqual(isSupportedLanguage("cpp"), false);
      assert.strictEqual(isSupportedLanguage("python"), false);
      assert.strictEqual(isSupportedLanguage(""), false);
      assert.strictEqual(isSupportedLanguage(null), false);
    });

    // 2. JavaScript submission is accepted and enqueued to jsQueue
    await testCase("2. Valid JavaScript submission is accepted and enqueued to js-queue", async () => {
      const initialSubs = createdSubmissions.length;
      const initialJobs = queuedJobs.javascript.length;

      const res = await fetch(`${baseUrl}/api/v1/submissions/${mockQuestion._id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${userToken}`,
        },
        body: JSON.stringify({
          language: "javascript",
          code: "function twoSum() { return [0, 1]; }",
        }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, "processing");
      assert.ok(data.submissionId);
      assert.strictEqual(createdSubmissions.length, initialSubs + 1);
      assert.strictEqual(queuedJobs.javascript.length, initialJobs + 1);
      assert.strictEqual(createdSubmissions[createdSubmissions.length - 1].language, "javascript");
    });

    // 3. Java submission is accepted and enqueued to javaQueue
    await testCase("3. Valid Java submission is accepted and enqueued to java-queue", async () => {
      const initialSubs = createdSubmissions.length;
      const initialJobs = queuedJobs.java.length;

      const res = await fetch(`${baseUrl}/api/v1/submissions/${mockQuestion._id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${userToken}`,
        },
        body: JSON.stringify({
          language: "java",
          code: "class Solution { public int[] twoSum() { return new int[]{0, 1}; } }",
        }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, "processing");
      assert.ok(data.submissionId);
      assert.strictEqual(createdSubmissions.length, initialSubs + 1);
      assert.strictEqual(queuedJobs.java.length, initialJobs + 1);
      assert.strictEqual(createdSubmissions[createdSubmissions.length - 1].language, "java");
    });

    // 4. C++ submission is rejected with 400 Bad Request (not stuck pending)
    await testCase("4. C++ submission is rejected with 400 (no DB record, no queued job)", async () => {
      const initialSubs = createdSubmissions.length;
      const initialJsJobs = queuedJobs.javascript.length;
      const initialJavaJobs = queuedJobs.java.length;

      const res = await fetch(`${baseUrl}/api/v1/submissions/${mockQuestion._id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${userToken}`,
        },
        body: JSON.stringify({
          language: "cpp",
          code: "class Solution {};",
        }),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.message.includes("Unsupported language"));
      assert.strictEqual(createdSubmissions.length, initialSubs, "Must not create a Submission document");
      assert.strictEqual(queuedJobs.javascript.length, initialJsJobs, "Must not queue a JS job");
      assert.strictEqual(queuedJobs.java.length, initialJavaJobs, "Must not queue a Java job");
    });

    // 5. Python submission is rejected with 400 Bad Request (no unhandled 500 error)
    await testCase("5. Python submission is rejected with 400 (no DB record, no queued job)", async () => {
      const initialSubs = createdSubmissions.length;
      const initialJsJobs = queuedJobs.javascript.length;
      const initialJavaJobs = queuedJobs.java.length;

      const res = await fetch(`${baseUrl}/api/v1/submissions/${mockQuestion._id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${userToken}`,
        },
        body: JSON.stringify({
          language: "python",
          code: "def twoSum(): pass",
        }),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.message.includes("Unsupported language"));
      assert.strictEqual(createdSubmissions.length, initialSubs, "Must not create a Submission document");
      assert.strictEqual(queuedJobs.javascript.length, initialJsJobs, "Must not queue a JS job");
      assert.strictEqual(queuedJobs.java.length, initialJavaJobs, "Must not queue a Java job");
    });

    // 6. Arbitrary unsupported language string is rejected with 400
    await testCase("6. Arbitrary unsupported language ('rust', null, '') is rejected with 400", async () => {
      const res1 = await fetch(`${baseUrl}/api/v1/submissions/${mockQuestion._id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${userToken}`,
        },
        body: JSON.stringify({ language: "rust", code: "fn main() {}" }),
      });
      assert.strictEqual(res1.status, 400);

      const res2 = await fetch(`${baseUrl}/api/v1/submissions/${mockQuestion._id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${userToken}`,
        },
        body: JSON.stringify({ language: "", code: "fn main() {}" }),
      });
      assert.strictEqual(res2.status, 400);
    });

    // 7. Submission schema enum enforces supported languages
    await testCase("7. Submission Mongoose model rejects unsupported languages during validation", async () => {
      const invalidSub = new Submission({
        userId: mockUser._id,
        questionId: mockQuestion._id,
        code: "print('hello')",
        language: "python",
      });

      let validationError = null;
      try {
        await invalidSub.validate();
      } catch (err) {
        validationError = err;
      }
      assert.ok(validationError, "Expected Mongoose validation error for python in Submission model");
      assert.ok(validationError.errors.language);
    });

    // 8. Question schema enum enforces supported languages
    await testCase("8. Question Mongoose model rejects unsupported starterCode languages", async () => {
      const invalidQuestion = new Question({
        questionNum: 99,
        title: "Test Question",
        slug: "test-question",
        difficulty: "Easy",
        description: "Test desc",
        functionName: "test",
        returnType: "int",
        starterCode: [{ language: "cpp", code: "int test() {}" }],
      });

      let validationError = null;
      try {
        await invalidQuestion.validate();
      } catch (err) {
        validationError = err;
      }
      assert.ok(validationError, "Expected Mongoose validation error for cpp in Question starterCode");
    });

    // 9. templateGenerator generateStarterCode produces only supported languages
    await testCase("9. generateStarterCode() produces starter templates only for supported languages", async () => {
      const starter = generateStarterCode({
        functionName: "solve",
        parameters: [{ name: "nums", type: "int[]" }],
        returnType: "int",
      });

      const languages = starter.map((s) => s.language);
      assert.deepStrictEqual(languages, ["javascript", "java"]);
      for (const lang of languages) {
        assert.strictEqual(isSupportedLanguage(lang), true);
      }
    });

    // 10. Admin POST /admin/questions rejects unsupported starterCode languages
    await testCase("10. Admin POST /admin/questions rejects starterCode with unsupported languages", async () => {
      const res = await fetch(`${baseUrl}/admin/questions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${adminToken}`,
        },
        body: JSON.stringify({
          title: "New Problem With Cpp",
          difficulty: "Easy",
          description: "Description",
          functionName: "solve",
          parameters: [{ name: "n", type: "int" }],
          returnType: "int",
          starterCode: [{ language: "cpp", code: "int solve(int n) {}" }],
        }),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.message.includes("Unsupported or invalid language in starterCode"));
    });

    // 10b. Admin POST /admin/questions rejects malformed starterCode (non-array or malformed items)
    await testCase("10b. Admin POST /admin/questions rejects malformed starterCode", async () => {
      const res1 = await fetch(`${baseUrl}/admin/questions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${adminToken}`,
        },
        body: JSON.stringify({
          title: "Malformed Problem 1",
          difficulty: "Easy",
          description: "Description",
          functionName: "solve",
          parameters: [{ name: "n", type: "int" }],
          returnType: "int",
          starterCode: "not-an-array",
        }),
      });
      assert.strictEqual(res1.status, 400);

      const res2 = await fetch(`${baseUrl}/admin/questions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${adminToken}`,
        },
        body: JSON.stringify({
          title: "Malformed Problem 2",
          difficulty: "Easy",
          description: "Description",
          functionName: "solve",
          parameters: [{ name: "n", type: "int" }],
          returnType: "int",
          starterCode: [null, { code: "only code" }],
        }),
      });
      assert.strictEqual(res2.status, 400);
    });

    // 11. Admin PUT /admin/questions/:id rejects unsupported starterCode languages
    await testCase("11. Admin PUT /admin/questions/:id rejects starterCode with unsupported languages", async () => {
      const res = await fetch(`${baseUrl}/admin/questions/${mockQuestion._id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${adminToken}`,
        },
        body: JSON.stringify({
          starterCode: [{ language: "python", code: "def solve(n): pass" }],
        }),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.message.includes("Unsupported or invalid language in starterCode"));
    });

    // 12. Frontend problem page source code only presents supported languages
    await testCase("12. Frontend problem page selector contains only supported languages", async () => {
      const frontendPagePath = path.resolve(__dirname, "../frontend/app/problems/[slug]/page.tsx");
      const frontendCode = fs.readFileSync(frontendPagePath, "utf-8");

      assert.ok(frontendCode.includes('<option value="javascript">JavaScript</option>'), "Frontend must include JavaScript option");
      assert.ok(frontendCode.includes('<option value="java">Java</option>'), "Frontend must include Java option");
      assert.ok(!frontendCode.includes('<option value="cpp">'), "Frontend must NOT include C++ option");
      assert.ok(!frontendCode.includes('<option value="python">'), "Frontend must NOT include Python option");
    });

  } finally {
    server.close();
  }

  console.log("\n=======================================================================");
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
  console.log("=======================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
