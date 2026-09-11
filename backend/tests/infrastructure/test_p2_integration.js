const assert = require("assert");
const http = require("http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Redis = require("ioredis");

process.env.JWT_SECRET = process.env.JWT_SECRET || "p2-integration-secret";

const createApp = require("../../app");
const eventBus = require("../../events/eventBus");
const {
  Contest,
  ContestParticipant,
  ContestLeaderboardSnapshot,
} = require("@koder/shared");
const User = require("../../models/User");
const {
  createContestLeaderboardLifecycle,
} = require("../../services/contestLeaderboardLifecycle");

const mongoUri =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/koder_p2_integration_test";

function request({ port, path, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path, headers }, (res) => {
      resolve({ req, res });
    });
    req.on("error", reject);
  });
}

function readSse(res, eventName, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let body = "";
    const finish = (value) => {
      clearTimeout(timer);
      res.off("data", onData);
      res.off("error", onError);
      resolve(value);
    };
    const timer = setTimeout(() => finish(body), timeoutMs);
    res.setEncoding("utf8");
    const onData = (chunk) => {
      body += chunk;
      if (body.includes("\n\n") && body.includes(eventName)) {
        finish(body);
      }
    };
    const onError = (error) => {
      clearTimeout(timer);
      res.off("data", onData);
      res.off("error", onError);
      reject(error);
    };
    res.on("data", onData);
    res.on("error", onError);
  });
}

async function runTests() {
  await mongoose.connect(mongoUri);
  await mongoose.connection.db.dropDatabase();
  await Promise.all([
    User.syncIndexes(),
    Contest.syncIndexes(),
    ContestParticipant.syncIndexes(),
    ContestLeaderboardSnapshot.syncIndexes(),
  ]);

  const user = await User.create({
    firstName: "P2",
    lastName: "Participant",
    email: `p2-${Date.now()}@example.com`,
    password: "hashed-password",
  });
  const outsider = await User.create({
    firstName: "P2",
    lastName: "Outsider",
    email: `p2-outsider-${Date.now()}@example.com`,
    password: "hashed-password",
  });
  const contest = await Contest.create({
    title: "P2 Integration Contest",
    slug: `p2-integration-${Date.now()}`,
    description: "P2 integration coverage",
    registrationOpenTime: new Date(Date.now() - 60_000),
    startTime: new Date(Date.now() - 30_000),
    endTime: new Date(Date.now() + 60_000),
    status: "RUNNING",
    createdBy: user._id,
    problems: [],
  });
  await ContestParticipant.create({
    contestId: contest._id,
    userId: user._id,
    registeredAt: new Date(),
  });

  const lifecycle = createContestLeaderboardLifecycle({
    distributedSnapshotLock: true,
  });
  const snapshotResult = await lifecycle.snapshotRunningContest(contest._id);
  assert.strictEqual(snapshotResult.status, "created");
  assert.strictEqual(
    await ContestLeaderboardSnapshot.countDocuments({
      contestId: contest._id,
      isFinal: false,
    }),
    1,
  );

  const secondLifecycle = createContestLeaderboardLifecycle({
    distributedSnapshotLock: true,
  });
  const concurrentResults = await Promise.all([
    lifecycle.snapshotRunningContest(contest._id),
    secondLifecycle.snapshotRunningContest(contest._id),
  ]);
  assert.deepStrictEqual(
    concurrentResults.map((result) => result.status).sort(),
    ["already_running", "created"],
  );
  assert.strictEqual(
    await ContestLeaderboardSnapshot.countDocuments({
      contestId: contest._id,
      isFinal: false,
    }),
    2,
  );

  await Contest.updateOne(
    { _id: contest._id },
    { $set: { status: "FINALIZED" } },
  );
  const stoppedResult = await lifecycle.snapshotRunningContest(contest._id);
  assert.strictEqual(stoppedResult.status, "skipped");

  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const port = server.address().port;
  const cookie = `auth_token=${jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET)}`;
  const outsiderCookie = `auth_token=${jwt.sign({ userId: outsider._id.toString() }, process.env.JWT_SECRET)}`;

  const unauthenticated = await request({ port, path: "/api/v1/events/stream" });
  assert.strictEqual(unauthenticated.res.statusCode, 401);
  unauthenticated.req.destroy();

  const participantConnection = await request({
    port,
    path: "/api/v1/events/stream",
    headers: { Cookie: cookie },
  });
  assert.strictEqual(participantConnection.res.statusCode, 200);
  assert.strictEqual(participantConnection.res.headers["content-type"], "text/event-stream; charset=utf-8");

  const outsiderConnection = await request({
    port,
    path: "/api/v1/events/stream",
    headers: { Cookie: outsiderCookie },
  });
  assert.strictEqual(outsiderConnection.res.statusCode, 200);

  const participantEvent = readSse(participantConnection.res, "submission.completed");
  const outsiderEvent = readSse(outsiderConnection.res, "submission.completed", 400);
  eventBus.emit("submission.completed", {
    submissionId: "submission-p2",
    userId: user._id.toString(),
    contestId: contest._id.toString(),
    status: "completed",
    verdict: "Accepted",
    sourceCode: "must-not-leak",
    password: "must-not-leak",
  });
  const [participantPayload, outsiderPayload] = await Promise.all([
    participantEvent,
    outsiderEvent,
  ]);
  assert.match(participantPayload, /submission\.completed/);
  assert.match(participantPayload, /submission-p2/);
  assert.doesNotMatch(participantPayload, /must-not-leak/);
  assert.strictEqual(outsiderPayload, "");

  const participantContestEvent = readSse(
    participantConnection.res,
    "contest.lifecycle",
  );
  const outsiderContestEvent = readSse(
    outsiderConnection.res,
    "contest.lifecycle",
    400,
  );
  eventBus.emit("contest.lifecycle", {
    contestId: contest._id.toString(),
    status: "RUNNING",
  });
  const [authorizedContestPayload, unauthorizedContestPayload] = await Promise.all([
    participantContestEvent,
    outsiderContestEvent,
  ]);
  assert.match(authorizedContestPayload, /contest\.lifecycle/);
  assert.strictEqual(unauthorizedContestPayload, "");

  participantConnection.req.destroy();
  outsiderConnection.req.destroy();
  await new Promise((resolve) => server.close(resolve));
  await eventBus.close();

  const redis = new Redis();
  const streamLength = await redis.xlen(eventBus.STREAM);
  assert.ok(streamLength >= 1 && streamLength <= 10000);
  await redis.quit();
  await mongoose.disconnect();
  console.log("P2 Mongo, Redis, snapshot, event-bus, and SSE integration tests passed");
  process.exit(0);
}

runTests().catch(async (error) => {
  console.error("P2 integration tests failed:", error);
  await eventBus.close().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
