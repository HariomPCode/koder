const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

process.env.JWT_SECRET = "test-secret-key-12345";
process.env.NODE_ENV = "test";

const Question = require("./models/Question");
const Submission = require("./models/Submission");

const queuePath = require.resolve("./queue");
require.cache[queuePath] = {
  id: queuePath,
  filename: queuePath,
  loaded: true,
  exports: {
    jsQueue: { add: async () => ({ id: "test-job" }) },
    javaQueue: { add: async () => ({ id: "test-job" }) },
  },
};

const createApp = require("./app");

async function runTests() {
  const app = createApp();
  const server = app.listen(0);
  const baseUrl = `http://localhost:${server.address().port}`;
  const token = jwt.sign(
    { userId: "60c72b2f9b1d8b0015f8e001" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  const originalQuestionFind = Question.find;
  const originalSubmissionFindOne = Submission.findOne;

  try {
    const notFoundResponse = await fetch(`${baseUrl}/api/v1/does-not-exist`);
    assert.strictEqual(notFoundResponse.status, 404);
    assert.deepStrictEqual(await notFoundResponse.json(), {
      message: "Route not found",
    });

    const authResponse = await fetch(`${baseUrl}/api/v1/user`);
    assert.strictEqual(authResponse.status, 401);
    assert.strictEqual((await authResponse.json()).message, "Unauthenticated User");

    const adminResponse = await fetch(`${baseUrl}/admin/users`);
    assert.strictEqual(adminResponse.status, 401);
    assert.strictEqual((await adminResponse.json()).message, "Unauthenticated User");

    const clientErrorResponse = await fetch(`${baseUrl}/api/v1/submissions/question-id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `auth_token=${token}`,
      },
      body: JSON.stringify({ language: "rust", code: "fn main() {}" }),
    });
    assert.strictEqual(clientErrorResponse.status, 400);
    assert.match((await clientErrorResponse.json()).message, /Unsupported language/);

    Submission.findOne = async () => {
      throw new mongoose.Error.CastError("ObjectId", "not-an-id", "_id");
    };
    const malformedIdResponse = await fetch(`${baseUrl}/api/v1/submissions/not-an-id`, {
      headers: { Cookie: `auth_token=${token}` },
    });
    assert.strictEqual(malformedIdResponse.status, 400);
    assert.deepStrictEqual(await malformedIdResponse.json(), {
      message: "Invalid resource identifier",
    });

    Question.find = () => {
      throw new Error("mongodb://internal.example/database-secret");
    };
    const unexpectedResponse = await fetch(`${baseUrl}/api/v1/questions`);
    assert.strictEqual(unexpectedResponse.status, 500);
    const unexpectedBody = await unexpectedResponse.json();
    assert.deepStrictEqual(unexpectedBody, {
      message: "Internal server error",
    });
    assert.ok(!JSON.stringify(unexpectedBody).includes("database-secret"));
    assert.ok(!JSON.stringify(unexpectedBody).includes("stack"));

    console.log("✓ Centralized error handling covers 404, auth, client, CastError, and unexpected errors");
  } finally {
    Question.find = originalQuestionFind;
    Submission.findOne = originalSubmissionFindOne;
    server.close();
  }
}

runTests().catch((error) => {
  console.error("Error-handling regression test failed:", error);
  process.exit(1);
});
