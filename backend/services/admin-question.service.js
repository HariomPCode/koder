const QuestionRepository = require("../repositories/question.repository");
const { generateStarterCode, SUPPORTED_LANGUAGES, isSupportedLanguage } = require("@koder/shared");
const AppError = require("../errors/appError");

async function listQuestions() {
  const questions = await QuestionRepository.findAll({ page: 1, limit: 100 });
  if (questions.length === 0) {
    throw AppError.notFound("No questions found");
  }
  return { questions };
}

async function getQuestionById(questionId) {
  const question = await QuestionRepository.findById(questionId);
  if (!question) {
    throw AppError.notFound("Question not found");
  }
  return question;
}

async function createQuestion(data) {
  const payload = { ...data };

  if (payload.slug) {
    payload.slug = payload.slug.trim().toLowerCase();
  } else if (payload.title) {
    payload.slug = payload.title.trim().toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-");
  }

  if (!payload.questionNum) {
    const lastQ = await QuestionRepository.findLatestQuestionNum();
    payload.questionNum = lastQ ? lastQ.questionNum + 1 : 1;
  }

  if ((!payload.starterCode || payload.starterCode.length === 0) && payload.functionName && payload.parameters) {
    payload.starterCode = generateStarterCode({
      functionName: payload.functionName,
      parameters: payload.parameters,
      returnType: payload.returnType,
    });
  }

  if (payload.starterCode !== undefined && payload.starterCode !== null) {
    if (!Array.isArray(payload.starterCode)) {
      throw AppError.validation("starterCode must be an array");
    }
    for (const item of payload.starterCode) {
      if (!item || typeof item !== "object" || !item.language || !isSupportedLanguage(item.language)) {
        throw AppError.validation(
          `Unsupported or invalid language in starterCode: '${item?.language}'. Supported languages are: ${SUPPORTED_LANGUAGES.join(", ")}`,
        );
      }
    }
  }

  const question = await QuestionRepository.create(payload);
  return { message: "Question created successfully", question };
}

async function updateQuestion(questionId, data) {
  const payload = { ...data };

  if (payload.slug) {
    payload.slug = payload.slug.trim().toLowerCase();
  }

  if ((!payload.starterCode || payload.starterCode.length === 0) && payload.functionName && payload.parameters) {
    payload.starterCode = generateStarterCode({
      functionName: payload.functionName,
      parameters: payload.parameters,
      returnType: payload.returnType,
    });
  }

  if (payload.starterCode !== undefined && payload.starterCode !== null) {
    if (!Array.isArray(payload.starterCode)) {
      throw AppError.validation("starterCode must be an array");
    }
    for (const item of payload.starterCode) {
      if (!item || typeof item !== "object" || !item.language || !isSupportedLanguage(item.language)) {
        throw AppError.validation(
          `Unsupported or invalid language in starterCode: '${item?.language}'. Supported languages are: ${SUPPORTED_LANGUAGES.join(", ")}`,
        );
      }
    }
  }

  const question = await QuestionRepository.updateById(questionId, payload);
  if (!question) {
    throw AppError.notFound("Question not found");
  }

  return { message: "Question updated successfully", question };
}

async function deleteQuestion(questionId) {
  const question = await QuestionRepository.findById(questionId);
  if (!question) {
    throw AppError.notFound("Question not found");
  }

  await QuestionRepository.deleteById(questionId);
  return { message: "Question deleted successfully" };
}

module.exports = {
  listQuestions,
  getQuestionById,
  createQuestion,
  updateQuestion,
  deleteQuestion,
};
