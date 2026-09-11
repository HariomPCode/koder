const client = require("prom-client");
const queue = require("../queue");

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: "koder_" });

const httpRequests = new client.Counter({
  name: "koder_http_requests_total",
  help: "Total number of HTTP requests handled by the backend.",
  labelNames: ["method", "status_code"],
  registers: [registry],
});

const httpDuration = new client.Histogram({
  name: "koder_http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

const queueJobs = new client.Gauge({
  name: "koder_queue_jobs",
  help: "Current BullMQ job counts by queue and state.",
  labelNames: ["queue", "state"],
  registers: [registry],
});

const queueHealth = new client.Gauge({
  name: "koder_queue_redis_ready",
  help: "Whether the backend Redis connection is ready.",
  registers: [registry],
});

const metricsCollectionErrors = new client.Counter({
  name: "koder_metrics_collection_errors_total",
  help: "Total errors encountered while collecting backend metrics.",
  labelNames: ["source"],
  registers: [registry],
});

const QUEUES = [
  ["javascript", queue.jsQueue],
  ["java", queue.javaQueue],
  ["python", queue.pythonQueue],
];
const QUEUE_STATES = ["waiting", "active", "completed", "failed", "delayed", "paused"];

function httpMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const statusCode = String(res.statusCode);
    const labels = { method: req.method, status_code: statusCode };
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    httpRequests.inc(labels);
    httpDuration.observe(labels, durationSeconds);
  });
  next();
}

async function collectQueueMetrics() {
  queueHealth.set(queue.connection?.status === "ready" ? 1 : 0);
  queueJobs.reset();

  await Promise.all(
    QUEUES.map(async ([queueName, queueInstance]) => {
      const counts = await queueInstance.getJobCounts(...QUEUE_STATES);
      for (const state of QUEUE_STATES) {
        queueJobs.set({ queue: queueName, state }, counts[state] || 0);
      }
    }),
  );
}

async function handler(req, res) {
  try {
    await collectQueueMetrics();
    res.set("Content-Type", registry.contentType);
    return res.status(200).send(await registry.metrics());
  } catch (error) {
    metricsCollectionErrors.inc({ source: "queue" });
    res.set("Content-Type", registry.contentType);
    return res.status(200).send(await registry.metrics());
  }
}

module.exports = {
  registry,
  httpMiddleware,
  collectQueueMetrics,
  handler,
};
