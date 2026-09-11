function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const rateLimitConfig = Object.freeze({
  auth: {
    limit: positiveInteger(process.env.RATE_LIMIT_AUTH_MAX, 10),
    windowSeconds: positiveInteger(process.env.RATE_LIMIT_AUTH_WINDOW_SECONDS, 60),
    failOpen: process.env.RATE_LIMIT_AUTH_FAIL_OPEN === "true",
  },
  practiceSubmission: {
    limit: positiveInteger(process.env.RATE_LIMIT_PRACTICE_SUBMISSION_MAX, 20),
    windowSeconds: positiveInteger(process.env.RATE_LIMIT_PRACTICE_SUBMISSION_WINDOW_SECONDS, 60),
    failOpen: process.env.RATE_LIMIT_SUBMISSION_FAIL_OPEN !== "false",
  },
  contestSubmission: {
    limit: positiveInteger(process.env.RATE_LIMIT_CONTEST_SUBMISSION_MAX, 30),
    windowSeconds: positiveInteger(process.env.RATE_LIMIT_CONTEST_SUBMISSION_WINDOW_SECONDS, 60),
    failOpen: process.env.RATE_LIMIT_SUBMISSION_FAIL_OPEN !== "false",
  },
});

module.exports = rateLimitConfig;
