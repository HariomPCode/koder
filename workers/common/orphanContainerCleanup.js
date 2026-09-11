const { spawn } = require("child_process");

const DEFAULT_CONTAINER_PREFIX = "koder-submission-";
const DEFAULT_OWNER_LABEL = "koder";

function parseContainerInspection(output) {
  try {
    const inspected = JSON.parse(output);
    return {
      labels: inspected?.Config?.Labels || {},
      createdAt: inspected?.Created ? Date.parse(inspected.Created) : NaN,
    };
  } catch (_) {
    return null;
  }
}

function shouldRemoveContainer({
  inspection,
  containerId,
  activeJobIds = new Set(),
  ownerLabel = DEFAULT_OWNER_LABEL,
  maxAgeMs,
  now = Date.now(),
}) {
  if (!inspection || !inspection.labels) return false;
  const labels = inspection.labels;
  if (
    labels["koder.managed"] !== "true" ||
    labels["koder.worker"] !== ownerLabel ||
    !labels["koder.jobId"] ||
    activeJobIds.has(String(labels["koder.jobId"]))
  ) {
    return false;
  }

  const createdAt = inspection.createdAt;
  return Number.isFinite(createdAt) && now - createdAt >= maxAgeMs && Boolean(containerId);
}

async function cleanupOrphanContainers({
  prefix = DEFAULT_CONTAINER_PREFIX,
  ownerLabel = DEFAULT_OWNER_LABEL,
  activeJobIds = new Set(),
  maxAgeMs = 5 * 60 * 1000,
  now = Date.now(),
} = {}) {
  return new Promise((resolve) => {
    const child = spawn("docker", ["ps", "-aq", "--filter", `name=${prefix}`]);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", () => resolve({ removed: 0, skipped: 0, stderr }));

    child.on("close", async (code) => {
      if (code !== 0) {
        resolve({ removed: 0, skipped: 0, stderr });
        return;
      }

      const containerIds = stdout
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean);

      if (containerIds.length === 0) {
        resolve({ removed: 0, skipped: 0, stderr });
        return;
      }

      let removed = 0;

      for (const containerId of containerIds) {
        const inspect = spawn("docker", ["inspect", containerId, "--format", "{{json .}}"]);
        let inspectionOutput = "";
        let inspectStderr = "";

        inspect.stdout.on("data", (chunk) => {
          inspectionOutput += chunk.toString();
        });

        inspect.stderr.on("data", (chunk) => {
          inspectStderr += chunk.toString();
        });

        await new Promise((innerResolve) => {
          inspect.on("error", () => innerResolve());
          inspect.on("close", async (inspectCode) => {
            try {
              if (inspectCode !== 0 || !inspectionOutput) {
                innerResolve();
                return;
              }

              const inspection = parseContainerInspection(inspectionOutput);
              if (shouldRemoveContainer({
                inspection,
                containerId,
                activeJobIds,
                ownerLabel,
                maxAgeMs,
                now,
              })) {
                await new Promise((deleteResolve) => {
                  const rm = spawn("docker", ["rm", "-f", containerId]);
                  rm.on("close", () => deleteResolve());
                  rm.on("error", () => deleteResolve());
                });
                removed += 1;
              }
            } catch (_) {
              // If inspection failed, leave the container untouched to avoid destroying unrelated work.
            }
            innerResolve();
          });
        });
      }

      resolve({ removed, skipped: containerIds.length - removed, stderr });
    });
  });
}

module.exports = cleanupOrphanContainers;
module.exports.DEFAULT_CONTAINER_PREFIX = DEFAULT_CONTAINER_PREFIX;
module.exports.DEFAULT_OWNER_LABEL = DEFAULT_OWNER_LABEL;
module.exports.parseContainerInspection = parseContainerInspection;
module.exports.shouldRemoveContainer = shouldRemoveContainer;
