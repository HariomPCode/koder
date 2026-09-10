const crypto = require("crypto");

const SUBMISSION_IDEMPOTENCY_TTL_SECONDS = 60;
const RESERVATION_WAIT_MS = 2000;
const RESERVATION_POLL_MS = 50;

const RELEASE_RESERVATION_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

const PUBLISH_SUBMISSION_SCRIPT = `
  local current = redis.call("GET", KEYS[1])
  if current == ARGV[1] then
    return redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3], "XX")
  end
  return nil
`;

function buildSubmissionIdempotencyKey({ userId, questionId, code }) {
  const identity = JSON.stringify([
    String(userId),
    String(questionId),
    String(code),
  ]);
  const digest = crypto.createHash("sha256").update(identity).digest("hex");
  return `idempotency:submission:${digest}`;
}

function createSubmissionIdempotency({ redis, ttlSeconds = SUBMISSION_IDEMPOTENCY_TTL_SECONDS } = {}) {
  if (!redis) {
    throw new TypeError("redis connection is required");
  }

  async function read(key) {
    const value = await redis.get(key);
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid submission idempotency record for ${key}`);
    }
  }

  async function reserve({ userId, questionId, code }) {
    const key = buildSubmissionIdempotencyKey({ userId, questionId, code });
    const token = crypto.randomUUID();
    const reservation = JSON.stringify({ state: "reserved", token });
    const acquired = await redis.set(key, reservation, "EX", ttlSeconds, "NX");

    if (acquired === "OK") {
      return { type: "owner", key, token };
    }

    const deadline = Date.now() + RESERVATION_WAIT_MS;
    while (Date.now() < deadline) {
      const record = await read(key);
      if (!record) {
        const retry = await redis.set(key, reservation, "EX", ttlSeconds, "NX");
        if (retry === "OK") {
          return { type: "owner", key, token };
        }
      } else if (record.state === "ready" && record.submissionId) {
        return { type: "existing", submissionId: record.submissionId };
      }

      await new Promise((resolve) => setTimeout(resolve, RESERVATION_POLL_MS));
    }

    const record = await read(key);
    if (record && record.state === "ready" && record.submissionId) {
      return { type: "existing", submissionId: record.submissionId };
    }

    return { type: "in_progress" };
  }

  async function publish({ key, token, submissionId }) {
    const value = JSON.stringify({
      state: "ready",
      submissionId: String(submissionId),
    });
    const published = await redis.eval(
      PUBLISH_SUBMISSION_SCRIPT,
      1,
      key,
      JSON.stringify({ state: "reserved", token }),
      value,
      String(ttlSeconds),
    );

    if (published !== "OK") {
      throw new Error("Submission idempotency reservation was lost before publication");
    }
  }

  async function release({ key, token }) {
    await redis.eval(RELEASE_RESERVATION_SCRIPT, 1, key, JSON.stringify({ state: "reserved", token }));
  }

  return {
    reserve,
    publish,
    release,
  };
}

module.exports = {
  SUBMISSION_IDEMPOTENCY_TTL_SECONDS,
  buildSubmissionIdempotencyKey,
  createSubmissionIdempotency,
};
