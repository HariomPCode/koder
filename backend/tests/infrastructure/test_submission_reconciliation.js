const assert = require("assert");
const {
  createReconciliationRunner,
  DEFAULT_BATCH_SIZE,
  STALE_SUBMISSION_AGE_MS,
} = require("../../jobs/submissionReconciliation");

function createSubmission(id, language = "javascript") {
  return {
    _id: id,
    userId: `user-${id}`,
    questionId: `question-${id}`,
    language,
  };
}

async function runTests() {
  const now = Date.parse("2026-09-10T12:00:00.000Z");
  const cutoff = new Date(now - STALE_SUBMISSION_AGE_MS);
  const submissions = [
    createSubmission("stale-1"),
    createSubmission("stale-2", "python"),
  ];
  const queried = [];
  const reconciled = [];
  const failures = [];
  const runner = createReconciliationRunner({
    repository: {
      findStaleCreatedSubmissions: async (options) => {
        queried.push(options);
        return submissions;
      },
    },
    reconcileSubmission: async (submission) => {
      reconciled.push(submission);
    },
    now: () => now,
    logger: { error: (...args) => failures.push(args) },
    batchSize: 2,
  });

  const result = await runner();
  assert.deepStrictEqual(queried, [{ cutoff, limit: 2 }]);
  assert.strictEqual(result.scanned, 2);
  assert.strictEqual(result.recovered, 2);
  assert.strictEqual(result.failed, 0);
  assert.deepStrictEqual(reconciled, [
    {
      submissionId: "stale-1",
      language: "javascript",
      userId: "user-stale-1",
      questionId: "question-stale-1",
    },
    {
      submissionId: "stale-2",
      language: "python",
      userId: "user-stale-2",
      questionId: "question-stale-2",
    },
  ]);

  const failureRunner = createReconciliationRunner({
    repository: {
      findStaleCreatedSubmissions: async ({ limit }) => {
        assert.strictEqual(limit, DEFAULT_BATCH_SIZE);
        return [createSubmission("fails"), createSubmission("recovers")];
      },
    },
    reconcileSubmission: async ({ submissionId }) => {
      if (submissionId === "fails") {
        throw new Error("Redis unavailable");
      }
    },
    now: () => now,
    logger: { error: (...args) => failures.push(args) },
  });
  const failureResult = await failureRunner();
  assert.deepStrictEqual(failureResult, {
    scanned: 2,
    recovered: 1,
    failed: 1,
  });
  assert.strictEqual(failures.length, 1);

  let concurrentQueueAdds = 0;
  let jobExists = false;
  const concurrentRunner = createReconciliationRunner({
    repository: {
      findStaleCreatedSubmissions: async () => [createSubmission("race")],
    },
    reconcileSubmission: async () => {
      if (!jobExists) {
        concurrentQueueAdds += 1;
        jobExists = true;
      }
    },
    now: () => now,
  });
  await Promise.all([concurrentRunner(), concurrentRunner()]);
  assert.strictEqual(concurrentQueueAdds, 1);
}

runTests()
  .then(() => console.log("✓ Submission CREATED reconciliation tests passed"))
  .catch((error) => {
    console.error("Submission reconciliation tests failed:", error);
    process.exit(1);
  });
