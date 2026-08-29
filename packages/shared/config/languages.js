/**
 * Authoritative source of truth for supported execution languages across the platform.
 */

const SUPPORTED_LANGUAGES = Object.freeze(["javascript", "java", "python"]);

const LANGUAGE_DISPLAY_NAMES = Object.freeze({
  javascript: "JavaScript",
  java: "Java",
  python: "Python",
});

function isSupportedLanguage(lang) {
  if (!lang || typeof lang !== "string") {
    return false;
  }
  return SUPPORTED_LANGUAGES.includes(lang.trim().toLowerCase());
}

function normalizeLanguage(lang) {
  if (!lang || typeof lang !== "string") {
    return null;
  }
  const normalized = lang.trim().toLowerCase();
  return SUPPORTED_LANGUAGES.includes(normalized) ? normalized : null;
}

module.exports = {
  SUPPORTED_LANGUAGES,
  LANGUAGE_DISPLAY_NAMES,
  isSupportedLanguage,
  normalizeLanguage,
};
