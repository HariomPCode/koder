const pino = require("pino");

function sanitizeValue(value) {
  if (value instanceof Error) {
    return {
      type: value.name,
      message: sanitizeValue(value.message),
      stack: sanitizeValue(value.stack),
    };
  }
  if (typeof value === "string") {
    return value
      .replace(/\b(?:mongodb(?:\+srv)?|redis|postgres(?:ql)?):\/\/[^\s]+/gi, "[redacted-url]")
      .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted-token]");
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]),
    );
  }
  return value;
}

function createLogger(component, options = {}) {
  const { stream = undefined, ...loggerOptions } = options;
  const logger = pino({
    level: process.env.LOG_LEVEL || "info",
    base: {
      service: "koder",
      component,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: (error) => sanitizeValue(pino.stdSerializers.err(error)),
    },
    hooks: {
      logMethod(inputArgs, method) {
        method.apply(this, inputArgs.map(sanitizeValue));
      },
    },
    ...loggerOptions,
  }, stream);

  return logger;
}

module.exports = {
  createLogger,
  sanitizeValue,
};
