const AppError = require("../errors/appError");
const { SUPPORTED_LANGUAGES, isSupportedLanguage, normalizeLanguage } = require("@koder/shared");

function requireFields(payload, requiredFields) {
  for (const field of requiredFields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      throw AppError.validation(`${field} is required`);
    }
  }
}

function validateEmail(email) {
  if (!email || typeof email !== "string" || !email.trim()) {
    throw AppError.validation("Email is required");
  }
}

function validatePassword(password) {
  if (!password || typeof password !== "string" || !password.trim()) {
    throw AppError.validation("Password is required");
  }
}

function validateAuthPayload({ email, password }) {
  validateEmail(email);
  validatePassword(password);
}

function validateSignupPayload({ firstName, lastName, email, password }) {
  requireFields({ firstName, lastName, email, password }, ["firstName", "lastName", "email", "password"]);
  validateEmail(email);
  validatePassword(password);
}

function validateSubmissionPayload({ language, code }) {
  if (!language || !isSupportedLanguage(language)) {
    throw AppError.validation(
      `Unsupported language: '${language}'. Supported languages are: ${SUPPORTED_LANGUAGES.join(", ")}`,
    );
  }

  if (typeof code !== "string" || !code.trim()) {
    throw AppError.validation("Code is required");
  }

  return normalizeLanguage(language);
}

function validateQuestionId(questionId) {
  if (!questionId) {
    throw AppError.validation("Question id is required");
  }
}

module.exports = {
  requireFields,
  validateEmail,
  validatePassword,
  validateAuthPayload,
  validateSignupPayload,
  validateSubmissionPayload,
  validateQuestionId,
};
