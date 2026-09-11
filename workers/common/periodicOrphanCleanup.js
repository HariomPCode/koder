const cleanupOrphanContainers = require("./orphanContainerCleanup");

function startPeriodicOrphanCleanup({
  intervalMs,
  maxAgeMs,
  activeJobIds,
  sweep = cleanupOrphanContainers,
  onError = () => {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let running = false;
  const run = async () => {
    if (running) return { skipped: "already_running" };
    running = true;
    try {
      return await sweep({ intervalMs, maxAgeMs, activeJobIds });
    } finally {
      running = false;
    }
  };
  const timer = setIntervalFn(() => {
    run().catch((error) => onError(error));
  }, intervalMs);
  timer.unref?.();

  return {
    timer,
    run,
    async stop() {
      clearIntervalFn(timer);
    },
  };
}

module.exports = startPeriodicOrphanCleanup;
