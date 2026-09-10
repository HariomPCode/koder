const assert = require("assert");

const workerFactoryPath = require.resolve("../../common/workerFactory");
const bullmqPath = require.resolve("bullmq");
const redisPath = require.resolve("ioredis");
const sharedPath = require.resolve("@koder/shared");
const hostCapacityPath = require.resolve("../../common/hostCapacity");
const cleanupPath = require.resolve("../../common/orphanContainerCleanup");
const dbPath = require.resolve("../../common/db");
const producerPath = require.resolve("../../leaderboard/producer");

function createWorkerHarness({ closeError = null } = {}) {
  const originalCaches = new Map(
    [
      workerFactoryPath,
      bullmqPath,
      redisPath,
      sharedPath,
      hostCapacityPath,
      cleanupPath,
      dbPath,
      producerPath,
    ].map((modulePath) => [modulePath, require.cache[modulePath]]),
  );
  const originalOnce = process.once;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const signalHandlers = new Map();
  const events = [];
  let exitCode = null;
  let closeResolver;
  let closeRejecter;

  class FakeWorker {
    static instances = [];

    constructor(queueName, processor, options) {
      this.queueName = queueName;
      this.processor = processor;
      this.options = options;
      this.activeJobs = 0;
      this.closing = false;
      this.closeCalls = [];
      this.closePromise = null;
      FakeWorker.instances.push(this);
    }

    on() {
      return this;
    }

    async process(job) {
      if (this.closing) {
        throw new Error("worker is closed");
      }

      this.activeJobs += 1;
      try {
        return await this.processor(job);
      } finally {
        this.activeJobs -= 1;
        if (this.closing && this.activeJobs === 0 && closeResolver) {
          closeResolver();
        }
      }
    }

    close(force) {
      this.closeCalls.push(force);
      this.closing = true;

      if (closeError) {
        return Promise.reject(closeError);
      }

      if (!force && this.activeJobs > 0) {
        this.closePromise = new Promise((resolve, reject) => {
          closeResolver = resolve;
          closeRejecter = reject;
        });
        return this.closePromise;
      }

      return Promise.resolve();
    }
  }

  class FakeRedis {
    quit() {
      events.push("redis.quit");
      return Promise.resolve();
    }
  }

  require.cache[bullmqPath] = {
    id: bullmqPath,
    filename: bullmqPath,
    loaded: true,
    exports: { Worker: FakeWorker },
  };
  require.cache[redisPath] = {
    id: redisPath,
    filename: redisPath,
    loaded: true,
    exports: FakeRedis,
  };
  require.cache[sharedPath] = {
    id: sharedPath,
    filename: sharedPath,
    loaded: true,
    exports: {
      getRedisConfig: () => ({}),
      updateSubmission: async () => null,
      markSubmissionRunning: async () => ({ status: "running" }),
      QUEUE_STALL_DEFAULTS: {
        stalledInterval: 30000,
        maxStalledCount: 2,
        lockDuration: 60000,
      },
      getWorkerConcurrencyConfig: () => ({
        concurrency: 1,
        hostMaxActiveJobs: 1,
        effectiveConcurrency: 1,
      }),
      setLeaderboardProjectionEnqueuer: () => undefined,
    },
  };
  require.cache[hostCapacityPath] = {
    id: hostCapacityPath,
    filename: hostCapacityPath,
    loaded: true,
    exports: {
      reserveExecutionSlot: async () => ({ acquired: true }),
      releaseExecutionSlot: async () => 0,
    },
  };
  require.cache[cleanupPath] = {
    id: cleanupPath,
    filename: cleanupPath,
    loaded: true,
    exports: async () => ({ removed: 0, skipped: 0 }),
  };
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: async () => undefined,
  };
  require.cache[producerPath] = {
    id: producerPath,
    filename: producerPath,
    loaded: true,
    exports: {
      enqueueLeaderboardProjection: async () => undefined,
      closeLeaderboardProjectionProducer: async () => {
        events.push("projection.close");
      },
    },
  };

  process.once = (signal, handler) => {
    signalHandlers.set(signal, handler);
    return process;
  };
  process.exit = (code) => {
    events.push(`process.exit:${code}`);
    exitCode = code;
  };
  console.log = () => undefined;
  console.warn = () => undefined;
  console.error = () => undefined;

  delete require.cache[workerFactoryPath];
  const createWorker = require(workerFactoryPath);

  return {
    createWorker,
    FakeWorker,
    signalHandlers,
    events,
    get exitCode() {
      return exitCode;
    },
    releaseClose() {
      if (closeRejecter) {
        closeRejecter(new Error("unused close rejection"));
      }
    },
    restore() {
      process.once = originalOnce;
      process.exit = originalExit;
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;

      for (const [modulePath, cachedModule] of originalCaches) {
        if (cachedModule) {
          require.cache[modulePath] = cachedModule;
        } else {
          delete require.cache[modulePath];
        }
      }
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function testGracefulShutdown(signal) {
  const harness = createWorkerHarness();

  try {
    await harness.createWorker("js-queue", async () => {
      await new Promise((resolve) => {
        harness.releaseJob = resolve;
      });
      return { status: "completed" };
    });

    const worker = harness.FakeWorker.instances.at(-1);
    const activeJob = worker.process({ data: {} });
    await flushMicrotasks();

    const shutdown = harness.signalHandlers.get(signal);
    assert.ok(shutdown, `${signal} handler should be registered`);
    shutdown();
    await flushMicrotasks();

    assert.deepStrictEqual(worker.closeCalls, [undefined]);
    assert.strictEqual(worker.closing, true);
    assert.strictEqual(worker.activeJobs, 1);
    assert.strictEqual(harness.exitCode, null);
    await assert.rejects(
      worker.process({ data: {} }),
      /worker is closed/,
    );

    harness.releaseJob();
    await activeJob;
    await flushMicrotasks();

    assert.deepStrictEqual(harness.events, [
      "projection.close",
      "redis.quit",
      "process.exit:0",
    ]);
    assert.strictEqual(harness.exitCode, 0);
  } finally {
    harness.restore();
  }
}

async function testShutdownFailure() {
  const shutdownError = new Error("close failed");
  const harness = createWorkerHarness({ closeError: shutdownError });

  try {
    await harness.createWorker("js-queue", async () => undefined);
    harness.signalHandlers.get("SIGTERM")();
    await flushMicrotasks();

    assert.deepStrictEqual(harness.events, ["process.exit:1"]);
    assert.strictEqual(harness.exitCode, 1);
  } finally {
    harness.restore();
  }
}

async function runTests() {
  await testGracefulShutdown("SIGTERM");
  await testGracefulShutdown("SIGINT");
  await testShutdownFailure();
  console.log("Worker shutdown tests passed");
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
