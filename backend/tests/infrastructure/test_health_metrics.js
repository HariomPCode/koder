const assert = require("assert");
const http = require("http");
const mongoose = require("mongoose");

const queuePath = require.resolve("../../queue");
const originalQueueCache = require.cache[queuePath];
let redisStatus = "ready";

function createFakeQueue(name) {
  return {
    async getJobCounts() {
      return {
        waiting: name === "javascript" ? 2 : 0,
        active: 1,
        completed: 3,
        failed: 0,
        delayed: 0,
        paused: 0,
      };
    },
  };
}

require.cache[queuePath] = {
  id: queuePath,
  filename: queuePath,
  loaded: true,
  exports: {
    connection: { get status() { return redisStatus; } },
    jsQueue: createFakeQueue("javascript"),
    javaQueue: createFakeQueue("java"),
    pythonQueue: createFakeQueue("python"),
  },
};

const createApp = require("../../app");

function request(server, path) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.get(`http://127.0.0.1:${address.port}${path}`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
  });
}

async function runTests() {
  const app = createApp();
  const server = app.listen(0);
  server.unref();

  const originalReadyState = mongoose.connection.readyState;
  try {
    mongoose.connection.readyState = 1;
    redisStatus = "ready";
    const live = await request(server, "/health/live");
    assert.strictEqual(live.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(live.body), { status: "ok" });

    mongoose.connection.readyState = 0;
    redisStatus = "ready";
    const liveWithoutMongo = await request(server, "/health/live");
    assert.strictEqual(liveWithoutMongo.statusCode, 200);
    const mongoUnavailable = await request(server, "/health/ready");
    assert.strictEqual(mongoUnavailable.statusCode, 503);
    assert.deepStrictEqual(JSON.parse(mongoUnavailable.body), {
      status: "not_ready",
      dependencies: { mongodb: false, redis: true },
    });

    mongoose.connection.readyState = 1;
    redisStatus = "ready";
    const ready = await request(server, "/health/ready");
    assert.strictEqual(ready.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(ready.body), {
      status: "ok",
      dependencies: { mongodb: true, redis: true },
    });

    redisStatus = "end";
    const redisUnavailable = await request(server, "/health/ready");
    assert.strictEqual(redisUnavailable.statusCode, 503);
    assert.deepStrictEqual(JSON.parse(redisUnavailable.body), {
      status: "not_ready",
      dependencies: { mongodb: true, redis: false },
    });

    const metricsResponse = await request(server, "/metrics");
    assert.strictEqual(metricsResponse.statusCode, 200);
    assert.match(metricsResponse.headers["content-type"], /text\/plain/);
    assert.match(metricsResponse.body, /# HELP koder_http_requests_total/);
    assert.match(metricsResponse.body, /# TYPE koder_queue_jobs gauge/);
    assert.match(metricsResponse.body, /koder_queue_jobs\{queue="javascript",state="waiting"\} 2/);
    assert.match(metricsResponse.body, /koder_queue_redis_ready 0/);
  } finally {
    mongoose.connection.readyState = originalReadyState;
    await new Promise((resolve) => server.close(resolve));
    if (originalQueueCache) {
      require.cache[queuePath] = originalQueueCache;
    } else {
      delete require.cache[queuePath];
    }
  }

  console.log("✓ Health and metrics tests passed");
}

runTests().catch((error) => {
  console.error("Health and metrics tests failed:", error);
  process.exit(1);
});
