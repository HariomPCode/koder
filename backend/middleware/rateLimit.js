const crypto = require("crypto");
const queue = require("../queue");
const config = require("../config/rateLimit");

const INCREMENT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return { current, redis.call("TTL", KEYS[1]) }
`;

function hashIdentity(identity) {
  return crypto.createHash("sha256").update(String(identity)).digest("hex").slice(0, 32);
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function sendLimitResponse(res, limit, retryAfterSeconds) {
  res.set("Retry-After", String(Math.max(1, retryAfterSeconds)));
  res.set("X-RateLimit-Limit", String(limit));
  res.set("X-RateLimit-Remaining", "0");
  return res.status(429).json({ message: "Too many requests. Please try again later." });
}

function createRateLimiter({
  name,
  limit,
  windowSeconds,
  keyResolver,
  failOpen,
  redis = queue.connection,
} = {}) {
  if (!name || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error("Invalid rate limiter configuration");
  }

  return async function rateLimitMiddleware(req, res, next) {
    const identity = keyResolver(req);
    const key = `koder:rate-limit:${name}:${hashIdentity(identity)}`;

    try {
      if (!redis || typeof redis.eval !== "function") {
        throw new Error("Rate-limit Redis client unavailable");
      }
      const [count, ttl] = await redis.eval(
        INCREMENT_SCRIPT,
        1,
        key,
        String(windowSeconds),
      );
      const remaining = Math.max(0, limit - Number(count));
      res.set("X-RateLimit-Limit", String(limit));
      res.set("X-RateLimit-Remaining", String(remaining));
      if (Number(count) > limit) {
        return sendLimitResponse(res, limit, Number(ttl));
      }
      return next();
    } catch (error) {
      if (failOpen) return next();
      return res.status(503).json({ message: "Rate limiting temporarily unavailable" });
    }
  };
}

const authRateLimit = createRateLimiter({
  name: "auth-ip",
  ...config.auth,
  keyResolver: clientIp,
});

const practiceSubmissionRateLimit = createRateLimiter({
  name: "practice-submission-user",
  ...config.practiceSubmission,
  keyResolver: (req) => `user:${req.userId || clientIp(req)}`,
});

const contestSubmissionRateLimit = createRateLimiter({
  name: "contest-submission-user",
  ...config.contestSubmission,
  keyResolver: (req) => `user:${req.userId || clientIp(req)}:contest:${req.params.contestId}`,
});

module.exports = {
  INCREMENT_SCRIPT,
  createRateLimiter,
  authRateLimit,
  practiceSubmissionRateLimit,
  contestSubmissionRateLimit,
  hashIdentity,
};
