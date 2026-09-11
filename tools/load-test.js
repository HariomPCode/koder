const http = require("http");
const https = require("https");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { URL } = require("url");
const execFileAsync = promisify(execFile);

const scenarios = {
  1: { users: 100, submissionsPerSecond: 0.6, sseConnections: 100 },
  2: { users: 1000, submissionsPerSecond: 6, sseConnections: 1000 },
  3: { users: 5000, submissionsPerSecond: 30, sseConnections: 5000 },
  4: { users: 10000, submissionsPerSecond: 60, sseConnections: 10000 },
};

const baseUrl = process.env.LOAD_TEST_BASE_URL || "http://127.0.0.1:5000";
const scenarioNumber = Number(process.env.LOAD_TEST_SCENARIO || 1);
const durationSeconds = Number(process.env.LOAD_TEST_DURATION_SECONDS || 30);
const maxConcurrency = Number(process.env.LOAD_TEST_MAX_CONCURRENCY || 100);
const sseEnabled = process.env.LOAD_TEST_SSE !== "false";
const authCookie = process.env.LOAD_TEST_AUTH_COOKIE || "";
const questionId = process.env.LOAD_TEST_QUESTION_ID || "";
const contestId = process.env.LOAD_TEST_CONTEST_ID || "";
const code = process.env.LOAD_TEST_CODE || "function solution() { return 1; }";
const telemetryIntervalMs = Number(process.env.LOAD_TEST_TELEMETRY_INTERVAL_MS || 5000);
const mongoContainer = process.env.LOAD_TEST_MONGO_CONTAINER || "leetcode-mongo-1";
const redisContainer = process.env.LOAD_TEST_REDIS_CONTAINER || "leetcode-redis-1";
const workerContainer = process.env.LOAD_TEST_WORKER_CONTAINER || "";

if (!scenarios[scenarioNumber]) {
  throw new Error(`LOAD_TEST_SCENARIO must be one of ${Object.keys(scenarios).join(", ")}`);
}

function parsePrometheusMetrics(text) {
  const metrics = {};
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([^{ ]+)(?:\{([^}]*)\})?\s+(.+)$/);
    if (!match) continue;
    const labels = {};
    for (const label of match[2] ? match[2].split(",") : []) {
      const pair = label.match(/^([^=]+)="([^"]*)"$/);
      if (pair) labels[pair[1]] = pair[2];
    }
    const key = `${match[1]}${Object.keys(labels).length ? JSON.stringify(labels) : ""}`;
    metrics[key] = Number(match[3]);
  }
  return metrics;
}

async function runCommand(file, args) {
  try {
    const result = await execFileAsync(file, args, { windowsHide: true, maxBuffer: 1024 * 1024 });
    return result.stdout.trim();
  } catch {
    return null;
  }
}

async function collectTelemetry() {
  const sample = { at: new Date().toISOString(), queue: {}, mongo: null, redis: null, worker: null };
  try {
    const metricsResponse = await request("GET", "/metrics");
    const parsed = parsePrometheusMetrics(metricsResponse.body);
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith("koder_queue_jobs")) {
        const labels = JSON.parse(key.slice("koder_queue_jobs".length));
        sample.queue[`${labels.queue}:${labels.state}`] = value;
      }
    }
  } catch {}

  const mongoStats = await runCommand("docker", [
    "exec", mongoContainer, "mongosh", "--quiet", "--eval",
    "const s=db.serverStatus(); print(JSON.stringify({connections:s.connections, opcounters:s.opcounters, mem:s.mem}));",
  ]);
  if (mongoStats) {
    try { sample.mongo = JSON.parse(mongoStats); } catch {}
  }

  const redisInfo = await runCommand("docker", ["exec", redisContainer, "redis-cli", "INFO", "memory"]);
  if (redisInfo) {
    sample.redis = {};
    for (const rawLine of redisInfo.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      const match = line.match(/^([^:]+):(.+)$/);
      if (match) sample.redis[match[1]] = Number.isNaN(Number(match[2])) ? match[2] : Number(match[2]);
    }
  }

  if (workerContainer) {
    const workerStats = await runCommand("docker", [
      "stats", "--no-stream", "--format", "{{json .}}", workerContainer,
    ]);
    if (workerStats) {
      try { sample.worker = JSON.parse(workerStats); } catch {}
    }
  }
  metrics.telemetry.push(sample);
}

async function waitForRunning(submissionId) {
  const deadline = Date.now() + Number(process.env.LOAD_TEST_QUEUE_WAIT_TIMEOUT_MS || 45000);
  let enqueueAt = null;
  while (Date.now() < deadline) {
    try {
      const response = await request("GET", `/api/v1/submissions/${submissionId}`);
      if (response.statusCode === 200) {
        const payload = JSON.parse(response.body);
        const submission = payload.submission || payload;
        if (!enqueueAt && submission.createdAt) {
          enqueueAt = new Date(submission.createdAt).getTime();
        }
        if (submission.status === "running") {
          const startedAt = submission.updatedAt ? new Date(submission.updatedAt).getTime() : Date.now();
          if (Number.isFinite(enqueueAt) && Number.isFinite(startedAt)) {
            metrics.queueWaitMs.push(Math.max(0, startedAt - enqueueAt));
          }
          return;
        }
        if (submission.status === "completed") return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const scenario = scenarios[scenarioNumber];
const metrics = {
  requests: 0,
  errors: 0,
  statuses: {},
  durationsMs: [],
  byPath: {},
  sse: { opened: 0, closed: 0, errors: 0 },
  queueWaitMs: [],
  telemetry: [],
};

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return Number(sorted[index].toFixed(2));
}

function request(method, path, body = undefined) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const transport = url.protocol === "https:" ? https : http;
    const payload = body === undefined ? null : JSON.stringify(body);
    const startedAt = process.hrtime.bigint();
    const headers = { accept: "application/json" };
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    if (authCookie) headers.cookie = authCookie;

    const req = transport.request(url, { method, headers }, (res) => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { responseBody += chunk; });
      res.on("end", () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const normalizedPath = url.pathname;
        metrics.requests++;
        metrics.durationsMs.push(durationMs);
        metrics.statuses[res.statusCode] = (metrics.statuses[res.statusCode] || 0) + 1;
        metrics.byPath[normalizedPath] = metrics.byPath[normalizedPath] || { requests: 0, errors: 0, durationsMs: [] };
        metrics.byPath[normalizedPath].requests++;
        metrics.byPath[normalizedPath].durationsMs.push(durationMs);
        if (res.statusCode >= 400) {
          metrics.errors++;
          metrics.byPath[normalizedPath].errors++;
        }
        resolve({ statusCode: res.statusCode, body: responseBody });
      });
    });
    req.on("error", (error) => {
      metrics.requests++;
      metrics.errors++;
      reject(error);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function openSseConnection() {
  return new Promise((resolve) => {
    const url = new URL("/api/v1/events/stream", baseUrl);
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        ...(authCookie ? { cookie: authCookie } : {}),
      },
    });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on("response", (res) => {
      if (res.statusCode !== 200) {
        metrics.sse.errors++;
        res.resume();
        finish({ close: () => req.destroy() });
        return;
      }
      metrics.sse.opened++;
      res.on("data", () => {});
      res.on("end", () => {
        metrics.sse.closed++;
        finish({ close: () => req.destroy() });
      });
      res.on("error", () => {
        metrics.sse.errors++;
        finish({ close: () => req.destroy() });
      });
      finish({ close: () => req.destroy() });
    });
    req.on("error", () => {
      metrics.sse.errors++;
      finish({ close: () => req.destroy() });
    });
    req.end();
  });
}

async function runLimited(tasks) {
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      try {
        await task();
      } catch {
        metrics.errors++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, tasks.length) }, worker));
}

async function runScenario() {
  const startedAt = Date.now();
  const endAt = startedAt + durationSeconds * 1000;
  const plannedSubmissions = Math.ceil(scenario.submissionsPerSecond * durationSeconds);
  const sseClients = [];
  const telemetryTimer = setInterval(() => {
    collectTelemetry().catch(() => {});
  }, telemetryIntervalMs);
  await collectTelemetry();
  if (sseEnabled && authCookie) {
    const target = Math.min(scenario.sseConnections, maxConcurrency);
    for (let index = 0; index < target; index++) {
      sseClients.push(await openSseConnection());
    }
  }

  let submissionCount = 0;
  const taskWorkers = Array.from(
    { length: Math.min(maxConcurrency, scenario.users) },
    (_, workerIndex) => async () => {
      let requestIndex = workerIndex;
      while (Date.now() < endAt) {
        const paths = [
          "/health/live",
          "/health/ready",
          "/metrics",
          "/api/v1/contests",
          "/api/v1/user/stats",
        ];
        if (contestId) paths.push(`/api/v1/contests/${contestId}/standings`);
        try {
          await request("GET", paths[requestIndex++ % paths.length]);
          if (questionId && submissionCount < plannedSubmissions) {
            submissionCount++;
            const response = await request("POST", `/api/v1/submissions/${questionId}`, {
              language: "javascript",
              code,
            });
            if (response.statusCode < 400) {
              const payload = JSON.parse(response.body);
              await waitForRunning(payload.submissionId);
            }
          }
        } catch {
          metrics.errors++;
        }
      }
    },
  );
  await Promise.all(taskWorkers.map((worker) => worker()));
  for (const client of sseClients) client.close();
  metrics.sse.closed += sseClients.length;
  clearInterval(telemetryTimer);
  await collectTelemetry();

  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  return {
    scenario: scenarioNumber,
    configured: scenario,
    plannedSubmissions,
    durationSeconds,
    elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
    throughputRequestsPerSecond: Number((metrics.requests / elapsedSeconds).toFixed(2)),
    errorRate: Number((metrics.errors / Math.max(metrics.requests, 1)).toFixed(4)),
    latencyMs: {
      p50: percentile(metrics.durationsMs, 50),
      p95: percentile(metrics.durationsMs, 95),
      p99: percentile(metrics.durationsMs, 99),
    },
    queueWaitMs: {
      samples: metrics.queueWaitMs.length,
      p50: percentile(metrics.queueWaitMs, 50),
      p95: percentile(metrics.queueWaitMs, 95),
      p99: percentile(metrics.queueWaitMs, 99),
    },
    telemetry: metrics.telemetry,
    statuses: metrics.statuses,
    sse: metrics.sse,
    byPath: Object.fromEntries(
      Object.entries(metrics.byPath).map(([path, value]) => [
        path,
        {
          requests: value.requests,
          errors: value.errors,
          p95Ms: percentile(value.durationsMs, 95),
        },
      ]),
    ),
    thresholds: {
      nonJudgeP95Ms: 300,
      peakQueueWaitSeconds: 10,
      errorRate: 0.001,
      note: "Thresholds are proposed local-test defaults from the backend roadmap, not production SLOs.",
    },
  };
}

runScenario()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.errorRate > result.thresholds.errorRate ? 1 : 0;
  })
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
