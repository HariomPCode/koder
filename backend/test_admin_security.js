const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const assert = require("assert");
const { execSync } = require("child_process");

// Set environment for test
process.env.JWT_SECRET = "test-secret-key-12345";
process.env.NODE_ENV = "test";

const queuePath = require.resolve("./queue");
require.cache[queuePath] = {
  id: queuePath,
  filename: queuePath,
  loaded: true,
  exports: {
    connection: { quit: async () => {}, disconnect: () => {} },
    jsQueue: { add: async () => ({ id: "js-job-1" }) },
    javaQueue: { add: async () => ({ id: "java-job-1" }) },
    pythonQueue: { add: async () => ({ id: "python-job-1" }) },
  },
};

const User = require("./models/User");
const Question = require("./models/Question");
const adminRoute = require("./routes/admin.route");
const authRoute = require("./routes/auth.route");
const userRoute = require("./routes/user.route");

async function runTests() {
  console.log("=======================================================================");
  console.log("TESTING ADMIN AUTHENTICATION & AUTHORIZATION SECURITY (ISSUE-001 & 002)");
  console.log("=======================================================================\n");

  // Real Mongoose Document instances
  const regularUserDoc = new User({
    _id: "60c72b2f9b1d8b0015f8e001",
    firstName: "Regular",
    lastName: "User",
    email: "user@test.com",
    password: "$2b$12$eX4mpL3hA5hP455w0rdH45hVaLu31234567890",
    role: "user",
  });

  const legacyUserDoc = new User({
    _id: "60c72b2f9b1d8b0015f8e003",
    firstName: "Legacy",
    lastName: "User",
    email: "legacy@test.com",
    password: "$2b$12$Leg4cyH45hP455w0rdH45hVaLu31234567890",
    // role is intentionally omitted to verify schema default
  });

  const adminUserDoc = new User({
    _id: "60c72b2f9b1d8b0015f8e002",
    firstName: "Admin",
    lastName: "Master",
    email: "admin@test.com",
    password: "$2b$12$Adm1nH45hP455w0rdH45hVaLu31234567890",
    role: "admin",
  });

  const dbUsers = [regularUserDoc, legacyUserDoc, adminUserDoc];

  const mockQuestions = [
    {
      _id: "60c72b2f9b1d8b0015f8e010",
      questionNum: 1,
      title: "Two Sum",
      slug: "two-sum",
      difficulty: "Easy",
      description: "Find two numbers that add up to target.",
      sampleTestCases: [{ input: "2 7 11 15\n9", output: "0 1" }],
      hiddenTestCases: [{ input: "3 3\n6", output: "0 1" }],
      tags: ["Array"],
    },
  ];

  // Intercept User queries
  User.findById = function (id) {
    const targetId = typeof id === "object" && id._id ? id._id.toString() : id.toString();
    const found = dbUsers.find((u) => u._id.toString() === targetId) || null;
    return {
      select: function (projection) {
        if (!found) return null;
        const doc = found.toObject();
        if (projection && (projection.password === 0 || projection === "-password")) {
          delete doc.password;
        }
        return doc;
      },
      then: function (resolve, reject) {
        return Promise.resolve(found).then(resolve, reject);
      },
    };
  };

  User.findOne = async function (query) {
    if (query.email) {
      return dbUsers.find((u) => u.email === query.email) || null;
    }
    return null;
  };

  User.find = function (query) {
    return {
      select: function (projection) {
        // Return cloned Mongoose documents with projected fields removed
        return dbUsers.map((u) => {
          const doc = u.toObject();
          if (projection && (projection.password === 0 || projection === "-password")) {
            delete doc.password;
          }
          return doc;
        });
      },
    };
  };

  let capturedCreatedUser = null;
  const originalUserCreate = User.create;
  User.create = async function (data) {
    capturedCreatedUser = new User(data);
    dbUsers.push(capturedCreatedUser);
    return capturedCreatedUser;
  };

  // Intercept Question queries
  Question.find = function () {
    return {
      sort: function () {
        return {
          limit: async function () {
            return mockQuestions;
          },
        };
      },
    };
  };

  Question.findById = async function (id) {
    return mockQuestions.find((q) => q._id.toString() === id.toString()) || null;
  };

  Question.findOne = function () {
    return {
      sort: async function () {
        return mockQuestions[0];
      },
    };
  };

  Question.create = async function (data) {
    return { _id: "60c72b2f9b1d8b0015f8e099", ...data };
  };

  Question.findByIdAndUpdate = async function (id, data) {
    const q = mockQuestions.find((q) => q._id.toString() === id.toString());
    if (!q) return null;
    return { ...q, ...data };
  };

  Question.findByIdAndDelete = async function (id) {
    return { _id: id };
  };

  // Create Express test app
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/v1/auth", authRoute);
  app.use("/api/v1/user", userRoute);
  app.use("/admin", adminRoute);

  const server = app.listen(0);
  server.unref();
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  // Generate tokens
  const normalUserToken = jwt.sign(
    { userId: regularUserDoc._id },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  const legacyUserToken = jwt.sign(
    { userId: legacyUserDoc._id },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  const adminUserToken = jwt.sign(
    { userId: adminUserDoc._id },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

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
    // 1. Unauthenticated request to GET /admin/users
    await testCase("1. Unauthenticated request to GET /admin/users -> 401 Denied", async () => {
      const res = await fetch(`${baseUrl}/admin/users`);
      assert.strictEqual(res.status, 401, `Expected status 401, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.message, "Unauthenticated User");
    });

    // 2. Unauthenticated request to GET /admin/questions
    await testCase("2. Unauthenticated request to GET /admin/questions -> 401 Denied", async () => {
      const res = await fetch(`${baseUrl}/admin/questions`);
      assert.strictEqual(res.status, 401, `Expected status 401, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.message, "Unauthenticated User");
    });

    // 3. Invalid/Malformed JWT token request to GET /admin/users
    await testCase("3. Invalid JWT token request to GET /admin/users -> 403 Denied", async () => {
      const res = await fetch(`${baseUrl}/admin/users`, {
        headers: { Cookie: "auth_token=invalid.jwt.token" },
      });
      assert.strictEqual(res.status, 403, `Expected status 403, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.message, "Invalid or expired token");
    });

    // 4. Authenticated normal user request to GET /admin/users
    await testCase("4. Authenticated normal user request to GET /admin/users -> 403 Denied", async () => {
      const res = await fetch(`${baseUrl}/admin/users`, {
        headers: { Cookie: `auth_token=${normalUserToken}` },
      });
      assert.strictEqual(res.status, 403, `Expected status 403, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.message, "Access denied. Admin privileges required.");
    });

    // 5. Authenticated legacy user (no explicit role field stored) defaults to user -> 403 Denied
    await testCase("5. Authenticated user with default/missing role field -> 403 Denied", async () => {
      const res = await fetch(`${baseUrl}/admin/users`, {
        headers: { Cookie: `auth_token=${legacyUserToken}` },
      });
      assert.strictEqual(res.status, 403, `Expected status 403, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.message, "Access denied. Admin privileges required.");
    });

    // 6. Authenticated normal user request to GET /admin/questions (hidden test cases protected)
    await testCase("6. Authenticated normal user request to GET /admin/questions -> 403 Denied (hidden test cases secured)", async () => {
      const res = await fetch(`${baseUrl}/admin/questions`, {
        headers: { Cookie: `auth_token=${normalUserToken}` },
      });
      assert.strictEqual(res.status, 403, `Expected status 403, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.message, "Access denied. Admin privileges required.");
    });

    // 7. Authenticated admin request to GET /admin/users -> 200 Allowed
    await testCase("7. Authenticated admin request to GET /admin/users -> 200 Allowed", async () => {
      const res = await fetch(`${baseUrl}/admin/users`, {
        headers: { Cookie: `auth_token=${adminUserToken}` },
      });
      assert.strictEqual(res.status, 200, `Expected status 200, got ${res.status}`);
      const body = await res.json();
      assert.ok(Array.isArray(body.users), "Expected body.users to be an array");
      assert.strictEqual(body.users.length >= 3, true);
    });

    // 8. Authenticated admin response from GET /admin/users contains NO password field or hash
    await testCase("8. Authenticated admin response from GET /admin/users -> No password field/hash in any user doc", async () => {
      const res = await fetch(`${baseUrl}/admin/users`, {
        headers: { Cookie: `auth_token=${adminUserToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      for (const u of body.users) {
        assert.strictEqual(u.password, undefined, `User ${u.email} leaked password field!`);
        const jsonStr = JSON.stringify(u);
        assert.ok(!jsonStr.includes("$2b$12$"), `User ${u.email} leaked bcrypt password hash!`);
      }
    });

    // 9. Authenticated admin can access problem management routes
    await testCase("9a. Authenticated admin GET /admin/questions -> 200 Allowed", async () => {
      const res = await fetch(`${baseUrl}/admin/questions`, {
        headers: { Cookie: `auth_token=${adminUserToken}` },
      });
      assert.strictEqual(res.status, 200, `Expected status 200, got ${res.status}`);
      const body = await res.json();
      assert.ok(Array.isArray(body.questions));
      assert.strictEqual(body.questions[0].title, "Two Sum");
    });

    await testCase("9b. Authenticated admin GET /admin/questions/:questionId -> 200 Allowed", async () => {
      const res = await fetch(`${baseUrl}/admin/questions/60c72b2f9b1d8b0015f8e010`, {
        headers: { Cookie: `auth_token=${adminUserToken}` },
      });
      assert.strictEqual(res.status, 200, `Expected status 200, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.question.title, "Two Sum");
    });

    await testCase("9c. Authenticated admin POST /admin/questions -> 201 Created", async () => {
      const res = await fetch(`${baseUrl}/admin/questions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${adminUserToken}`,
        },
        body: JSON.stringify({
          title: "New Problem",
          difficulty: "Easy",
          description: "A problem description",
          functionName: "solve",
          parameters: [{ name: "n", type: "int" }],
          returnType: "int",
        }),
      });
      assert.strictEqual(res.status, 201, `Expected status 201, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.message, "Question created successfully");
    });

    await testCase("9d. Authenticated admin PUT /admin/questions/:questionId -> 200 Updated", async () => {
      const res = await fetch(`${baseUrl}/admin/questions/60c72b2f9b1d8b0015f8e010`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${adminUserToken}`,
        },
        body: JSON.stringify({
          title: "Two Sum Updated",
        }),
      });
      assert.strictEqual(res.status, 200, `Expected status 200, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.message, "Question updated successfully");
    });

    await testCase("9e. Authenticated admin DELETE /admin/questions/:questionId -> 200 Deleted", async () => {
      const res = await fetch(`${baseUrl}/admin/questions/60c72b2f9b1d8b0015f8e010`, {
        method: "DELETE",
        headers: {
          Cookie: `auth_token=${adminUserToken}`,
        },
      });
      assert.strictEqual(res.status, 200, `Expected status 200, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.message, "Question deleted successfully");
    });

    // 10. Signup endpoint role escalation prevention
    await testCase("10. Signup role escalation prevention -> Client cannot inject role: 'admin'", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: "Malicious",
          lastName: "Actor",
          email: "malicious@test.com",
          password: "password123",
          role: "admin",
          isAdmin: true,
        }),
      });
      assert.strictEqual(res.status, 200);
      assert.ok(capturedCreatedUser, "User.create must have been called");
      assert.strictEqual(capturedCreatedUser.role, "user", `User was created with role: "${capturedCreatedUser.role}" instead of "user"!`);
    });

    // 11. User model toJSON schema transform
    await testCase("11. User schema toJSON transform automatically strips password property", async () => {
      const u = new User({
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        password: "secret_password_hash",
        role: "user",
      });
      const json = u.toJSON();
      assert.strictEqual(json.password, undefined, "toJSON() must delete password property");
      assert.strictEqual(json.role, "user", "toJSON() must retain role property");
    });

    // 12. Authenticated normal user can still access non-admin user routes
    await testCase("12. Authenticated normal user can access GET /api/v1/user -> 200 Allowed", async () => {
      const res = await fetch(`${baseUrl}/api/v1/user`, {
        headers: { Cookie: `auth_token=${normalUserToken}` },
      });
      assert.strictEqual(res.status, 200, `Expected status 200, got ${res.status}`);
      const body = await res.json();
      assert.ok(body.user, "Expected body to contain user object");
      assert.strictEqual(body.user.email, "user@test.com");
      assert.strictEqual(body.user.password, undefined);
    });

    // 13. promoteAdmin.js CLI validation tests
    await testCase("13. promoteAdmin.js rejects missing and invalid email arguments", async () => {
      try {
        execSync("node promoteAdmin.js", { stdio: "pipe", cwd: __dirname });
        assert.fail("Should have exited with code 1 for missing argument");
      } catch (err) {
        assert.strictEqual(err.status, 1);
      }

      try {
        execSync("node promoteAdmin.js invalid-email-format", { stdio: "pipe", cwd: __dirname });
        assert.fail("Should have exited with code 1 for invalid email format");
      } catch (err) {
        assert.strictEqual(err.status, 1);
      }
    });

  } finally {
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
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
