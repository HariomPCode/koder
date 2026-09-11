const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const apiRoute = require("./routes/apiRoute");
const adminRoute = require("./routes/admin.route");
const healthRoute = require("./routes/health.route");
const metrics = require("./services/metrics");
const { createLogger } = require("@koder/shared");
const { notFoundHandler, errorHandler } = require("./errorHandler");
const requestLogger = createLogger("http");

function createApp() {
  const app = express();

  app.use(
    cors({
      origin: "http://localhost:3000",
      credentials: true,
    }),
  );

  app.use(express.json());
  app.use(cookieParser());
  app.use(metrics.httpMiddleware);
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      requestLogger.info({
        event: "http_request",
        method: req.method,
        path: req.route?.path || req.path,
        statusCode: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
        ...(req.userId ? { userId: String(req.userId) } : {}),
      });
    });
    next();
  });

  app.use("/health", healthRoute);
  app.get("/metrics", metrics.handler);
  app.use("/api/v1", apiRoute);
  app.use("/admin", adminRoute);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
