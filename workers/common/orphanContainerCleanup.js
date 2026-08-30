const { spawn } = require("child_process");

const DEFAULT_CONTAINER_PREFIX = "koder-submission-";

async function cleanupOrphanContainers({
  prefix = DEFAULT_CONTAINER_PREFIX,
  ownerLabel = "koder-worker",
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
        const inspect = spawn("docker", ["inspect", containerId, "--format", "{{json .Config.Labels}}"]);
        let labelOutput = "";
        let inspectStderr = "";

        inspect.stdout.on("data", (chunk) => {
          labelOutput += chunk.toString();
        });

        inspect.stderr.on("data", (chunk) => {
          inspectStderr += chunk.toString();
        });

        await new Promise((innerResolve) => {
          inspect.on("error", () => innerResolve());
          inspect.on("close", async (inspectCode) => {
            try {
              if (inspectCode !== 0 || !labelOutput) {
                innerResolve();
                return;
              }

              const labels = JSON.parse(labelOutput || "{}");
              const shouldRemove = labels?.["com.docker.compose.project"] === undefined &&
                labels?.["koder.worker"] !== ownerLabel;

              if (shouldRemove) {
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
