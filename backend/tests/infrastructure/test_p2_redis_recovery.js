const assert = require("assert");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const Redis = require("ioredis");
const { ExternalEventBus } = require("@koder/shared").eventBus;
const eventBus = require("../../events/eventBus");
const User = require("../../models/User");
const createApp = require("../../app");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

process.env.JWT_SECRET = process.env.JWT_SECRET || "p2-integration-secret";

const execFileAsync = promisify(execFile);
const composeArgs = ["compose", "stop", "redis"];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function publishUntilReceived(bus, events, phase) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = crypto.randomUUID();
    bus.emit("recovery.test", { phase, id });
    await wait(350);
    if (events.some((event) => event.id === id)) return id;
  }
  throw new Error(`Redis subscriber did not receive ${phase}`);
}

async function waitForRedis() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const redis = new Redis({ lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await redis.connect();
      await redis.ping();
      await redis.quit();
      return;
    } catch (_) {
      await redis.disconnect();
      await wait(500);
    }
  }
  throw new Error("Redis did not recover within the test timeout");
}

function openHttpStream(port, cookie) {
  return new Promise((resolve, reject) => {
    const request = require("http").get({
      host: "127.0.0.1",
      port,
      path: "/api/v1/events/stream",
      headers: { Cookie: cookie },
    }, (response) => resolve({ request, response }));
    request.on("error", reject);
  });
}

function waitForSseEvent(response, eventName, expectedPayload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let body = "";
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}`)), timeoutMs);
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      body += chunk;
      if (body.includes(`event: ${eventName}`) && body.includes(expectedPayload)) {
        clearTimeout(timer);
        resolve(body);
      }
    });
    response.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function runTests() {
  const first = new ExternalEventBus();
  const second = new ExternalEventBus();
  const firstEvents = [];
  const secondEvents = [];
  const unsubscribeFirst = first.on("recovery.test", (payload) => firstEvents.push(payload));
  const unsubscribeSecond = second.on("recovery.test", (payload) => secondEvents.push(payload));

  try {
    const beforeId = await publishUntilReceived(first, secondEvents, "before-outage");
    assert.strictEqual(firstEvents.filter((event) => event.id === beforeId).length, 1);
    assert.strictEqual(secondEvents.filter((event) => event.id === beforeId).length, 1);

    await execFileAsync("docker", composeArgs);
    await wait(1200);

    assert.doesNotThrow(() => first.emit("recovery.test", { phase: "during-outage" }));
    assert.doesNotThrow(() => second.emit("recovery.test", { phase: "during-outage" }));

    await execFileAsync("docker", ["compose", "start", "redis"]);
    await waitForRedis();
    await wait(2500);

    const afterId = await publishUntilReceived(first, secondEvents, "after-outage");
    assert.strictEqual(firstEvents.filter((event) => event.id === afterId).length, 1);
    assert.strictEqual(secondEvents.filter((event) => event.id === afterId).length, 1);

    unsubscribeFirst();
    unsubscribeSecond();

    await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/koder_p2_sse_recovery_test");
    const user = await User.create({
      firstName: "SSE",
      lastName: "Recovery",
      email: `sse-recovery-${Date.now()}@example.com`,
      password: "hashed-password",
    });
    const server = await new Promise((resolve) => {
      const instance = createApp().listen(0, () => resolve(instance));
    });
    const cookie = `auth_token=${jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET || "p2-integration-secret")}`;
    const stream = await openHttpStream(server.address().port, cookie);
    assert.strictEqual(stream.response.statusCode, 200);

    await execFileAsync("docker", composeArgs);
    await wait(1200);
    assert.doesNotThrow(() => eventBus.emit("sse.recovery", {
      userId: user._id.toString(),
      submissionId: "dropped-during-outage",
    }));
    await execFileAsync("docker", ["compose", "start", "redis"]);
    await waitForRedis();
    await wait(2500);

    const delivered = waitForSseEvent(
      stream.response,
      "sse.recovery",
      "delivered-after-recovery",
    );
    eventBus.emit("sse.recovery", {
      userId: user._id.toString(),
      submissionId: "delivered-after-recovery",
    });
    const ssePayload = await delivered;
    assert.match(ssePayload, /delivered-after-recovery/);
    assert.strictEqual(
      (ssePayload.match(/delivered-after-recovery/g) || []).length,
      1,
    );
    stream.request.destroy();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();

    console.log("Redis outage/recovery, multi-instance delivery, and duplicate suppression tests passed");
  } finally {
    await execFileAsync("docker", ["compose", "start", "redis"]).catch(() => {});
    await waitForRedis().catch(() => {});
    await Promise.all([first.close(), second.close(), eventBus.close()]);
    await mongoose.disconnect().catch(() => {});
  }
}

runTests().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error("Redis outage/recovery integration test failed:", error);
  process.exit(1);
});
