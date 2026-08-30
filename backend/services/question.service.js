const QuestionRepository = require("../repositories/question.repository");

async function listQuestions({ page = 1, limit = 20 } = {}) {
  const normalizedPage = Number(page) > 0 ? Number(page) : 1;
  const normalizedLimit = Math.min(Number(limit) || 20, 100);
  const skip = (normalizedPage - 1) * normalizedLimit;

  return QuestionRepository.findAll({
    page: normalizedPage,
    limit: normalizedLimit,
    skip,
  });
}

async function getQuestionBySlug(slug) {
  return QuestionRepository.findOneBySlug(slug);
}

module.exports = {
  listQuestions,
  getQuestionBySlug,
};
