const IoRedis = require("ioredis");
const { Queue } = require("bullmq");
const {
  QUEUE_NAMES,
  JOB_NAMES,
  getRedisConfig,
  buildQueueJobId,
  createQueueJobOptions,
  QUEUE_STALL_DEFAULTS,
} = require("@koder/shared");
const AppError = require("../errors/appError");
const SubmissionRepository = require("../repositories/submission.repository");
const { SUBMISSION_STATUS } = require("@koder/shared");

const connection = new IoRedis(getRedisConfig());

function createQueueInstance(queueName) {
  return new Queue(queueName, {
    connection,
    defaultJobOptions: createQueueJobOptions(),
  });
}

const jsQueue = createQueueInstance(QUEUE_NAMES.javascript);
const javaQueue = createQueueInstance(QUEUE_NAMES.java);
const pythonQueue = createQueueInstance(QUEUE_NAMES.python);

const queueMap = {
  javascript: jsQueue,
  java: javaQueue,
  python: pythonQueue,
};

function getQueueForLanguage(language) {
  return queueMap[language];
}

function isHealthy() {
  return Boolean(connection) && ["ready", "connecting"].includes(connection.status);
}

async function enqueueSubmission({ submissionId, language, userId, questionId }) {
  const normalizedLanguage = String(language || "").toLowerCase();
  const queue = queueMap[normalizedLanguage];

  if (!queue) {
    throw AppError.badRequest(`No queue configured for language: ${normalizedLanguage}`);
  }

  const jobId = buildQueueJobId(normalizedLanguage, submissionId);
  const payload = {
    schemaVersion: 1,
    submissionId: String(submissionId),
    userId: String(userId),
    questionId: String(questionId),
    language: normalizedLanguage,
  };

  try {
    const job = await queue.add(JOB_NAMES.EXECUTE, payload, {
      jobId,
      ...createQueueJobOptions(),
    });

    if (job) {
      await SubmissionRepository.updateStatus(submissionId, SUBMISSION_STATUS.QUEUED).catch(() => {});
    }

    return job;
  } catch (error) {
    if (error && /already exists/i.test(error.message || "")) {
      try {
        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
          await SubmissionRepository.updateStatus(submissionId, SUBMISSION_STATUS.QUEUED).catch(() => {});
          return existingJob;
        }
      } catch (lookupError) {
        // fall through to unavailable error below.
      }
    }

    await SubmissionRepository.updateStatus(submissionId, SUBMISSION_STATUS.CREATED).catch(() => {});
    throw AppError.unavailable("Queue unavailable while processing your submission");
  }
}

module.exports = {
  connection,
  jsQueue,
  javaQueue,
  pythonQueue,
  queueMap,
  JOB_NAMES,
  QUEUE_STALL_DEFAULTS,
  enqueueSubmission,
  getQueueForLanguage,
  isHealthy,
  buildQueueJobId,
  createQueueJobOptions,
};
