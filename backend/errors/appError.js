class AppError extends Error {
  constructor(message, statusCode = 500, code = "APP_ERROR", details = null) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details = null) {
    return new AppError(message, 400, "BAD_REQUEST", details);
  }

  static unauthorized(message = "Unauthorized") {
    return new AppError(message, 401, "UNAUTHORIZED");
  }

  static forbidden(message = "Forbidden") {
    return new AppError(message, 403, "FORBIDDEN");
  }

  static notFound(message = "Not found") {
    return new AppError(message, 404, "NOT_FOUND");
  }

  static conflict(message = "Resource already exists") {
    return new AppError(message, 409, "CONFLICT");
  }

  static unavailable(message = "Service temporarily unavailable") {
    return new AppError(message, 503, "SERVICE_UNAVAILABLE");
  }

  static validation(message, details = null) {
    return new AppError(message, 400, "VALIDATION_ERROR", details);
  }
}

module.exports = AppError;
