const assert = require("assert");
const queuePath = require.resolve("../../queue");
const originalQueueCache = require.cache[queuePath];
require.cache[queuePath] = {
  id: queuePath,
  filename: queuePath,
  loaded: true,
  exports: { connection: null },
};
const { createRateLimiter, hashIdentity } = require("../../middleware/rateLimit");

class FakeRedis {
  constructor() {
    this.values = new Map();
    this.now = 0;
  }

  async eval(_script, _keyCount, key, ttl) {
    const current = this.values.get(key);
    if (!current || current.expiresAt <= this.now) {
      this.values.set(key, { count: 1, expiresAt: this.now + Number(ttl) * 1000 });
      return [1, Number(ttl)];
    }
    current.count += 1;
    return [current.count, Math.ceil((current.expiresAt - this.now) / 1000)];
  }
}

function responseStub() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function runTests() {
  const redis = new FakeRedis();
  const limiter = createRateLimiter({
    name: "test",
    limit: 2,
    windowSeconds: 60,
    keyResolver: (req) => req.userId,
    failOpen: false,
    redis,
  });

  const nextCalls = [];
  for (let index = 0; index < 2; index += 1) {
    const res = responseStub();
    await limiter({ userId: "user-1" }, res, () => nextCalls.push("allowed"));
    assert.strictEqual(res.statusCode, 200);
  }
  const rejected = responseStub();
  await limiter({ userId: "user-1" }, rejected, () => nextCalls.push("unexpected"));
  assert.strictEqual(rejected.statusCode, 429);
  assert.strictEqual(rejected.headers["Retry-After"], "60");
  assert.strictEqual(nextCalls.length, 2);

  const separateIdentity = responseStub();
  await limiter({ userId: "user-2" }, separateIdentity, () => nextCalls.push("separate"));
  assert.strictEqual(separateIdentity.statusCode, 200);

  redis.now = 60000;
  const afterWindow = responseStub();
  await limiter({ userId: "user-1" }, afterWindow, () => nextCalls.push("expired"));
  assert.strictEqual(afterWindow.statusCode, 200);

  const unavailable = createRateLimiter({
    name: "fail-closed",
    limit: 1,
    windowSeconds: 60,
    keyResolver: () => "identity",
    failOpen: false,
    redis: { eval: async () => { throw new Error("redis down"); } },
  });
  const unavailableResponse = responseStub();
  await unavailable({}, unavailableResponse, () => nextCalls.push("unexpected"));
  assert.strictEqual(unavailableResponse.statusCode, 503);

  const available = createRateLimiter({
    name: "fail-open",
    limit: 1,
    windowSeconds: 60,
    keyResolver: () => "identity",
    failOpen: true,
    redis: { eval: async () => { throw new Error("redis down"); } },
  });
  const availableResponse = responseStub();
  await available({}, availableResponse, () => nextCalls.push("fail-open"));
  assert.strictEqual(availableResponse.statusCode, 200);

  assert.strictEqual(hashIdentity("secret@example.com").length, 32);
  assert.ok(!hashIdentity("secret@example.com").includes("secret"));
  console.log("Rate-limiting tests passed");
}

runTests().catch((error) => {
  console.error("Rate-limiting tests failed:", error);
  process.exit(1);
}).finally(() => {
  if (originalQueueCache) require.cache[queuePath] = originalQueueCache;
  else delete require.cache[queuePath];
});
