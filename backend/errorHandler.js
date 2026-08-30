const AppError = require("./errors/appError");

function notFoundHandler(req, res, next) {
  const error = new AppError("Route not found", 404, "NOT_FOUND");
  next(error);
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err?.code === "NOT_FOUND" || err?.statusCode === 404) {
    return res.status(404).json({
      message: "Route not found",
    });
  }

  if (err?.name === "ValidationError") {
    return res.status(400).json({
      message: "Validation failed",
    });
  }

  if (err?.name === "CastError") {
    return res.status(400).json({
      message: "Invalid resource identifier",
    });
  }

  if (err?.code === 11000) {
    return res.status(409).json({
      message: "Resource already exists",
    });
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      message: "Invalid JSON payload",
    });
  }

  console.error("Unhandled application error:", err);
  return res.status(500).json({
    message: "Internal server error",
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
