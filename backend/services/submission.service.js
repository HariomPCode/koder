const { SUBMISSION_STATUS } = require("@koder/shared");
const queue = require("../queue");
const SubmissionRepository = require("../repositories/submission.repository");
const QuestionRepository = require("../repositories/question.repository");
const AppError = require("../errors/appError");
const { validateSubmissionPayload, validateQuestionId } = require("../validators/request.validators");

async function createSubmission({ userId, questionId, language, code }) {
  validateQuestionId(questionId);
  const normalizedLang = validateSubmissionPayload({ language, code });

  const question = await QuestionRepository.findById(questionId);
  if (!question) {
    throw AppError.notFound("Question does not exist");
  }

  const submission = await SubmissionRepository.create({
    userId,
    questionId,
    code,
    language: normalizedLang,
    status: SUBMISSION_STATUS.CREATED,
  });

  try {
    const enqueue = typeof queue.enqueueSubmission === "function"
      ? queue.enqueueSubmission.bind(queue)
      : null;

    if (enqueue) {
      await enqueue({
        submissionId: submission._id,
        language: normalizedLang,
        userId,
        questionId,
      });
    } else {
      const compatibilityQueueMap = {
        javascript: "jsQueue",
        java: "javaQueue",
        python: "pythonQueue",
      };

      const targetQueue =
        (queue.getQueueForLanguage && queue.getQueueForLanguage(normalizedLang)) ||
        queue[compatibilityQueueMap[normalizedLang]] ||
        null;

      if (!targetQueue || typeof targetQueue.add !== "function") {
        throw AppError.badRequest(`No queue configured for language: ${normalizedLang}`);
      }

      await targetQueue.add("execute", {
        submissionId: submission._id,
        userId,
        questionId,
      });
    }

    await SubmissionRepository.updateStatus(submission._id, SUBMISSION_STATUS.QUEUED);
  } catch (error) {
    await SubmissionRepository.updateStatus(submission._id, SUBMISSION_STATUS.CREATED).catch(() => {});

    if (error instanceof AppError) {
      throw error;
    }

    throw AppError.unavailable("Queue unavailable while processing your submission");
  }

  return {
    submissionId: submission._id,
    status: "processing",
  };
}

async function getSubmissionById({ submissionId, userId }) {
  validateQuestionId(submissionId);
  const submission = await SubmissionRepository.findByUserAndSubmissionId(userId, submissionId);

  if (!submission) {
    throw AppError.notFound("Submission not found");
  }

  return submission;
}

async function getUserQuestionSubmissions({ userId, questionId }) {
  validateQuestionId(questionId);
  const submissions = await SubmissionRepository.findUserQuestionSubmissions({ userId, questionId });

  if (submissions.length === 0) {
    return { message: "No submissions made for this problem" };
  }

  return { submissions };
}

module.exports = {
  createSubmission,
  getSubmissionById,
  getUserQuestionSubmissions,
};
