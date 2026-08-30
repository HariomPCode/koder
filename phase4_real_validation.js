const { execSync } = require('child_process');
const mongoose = require('mongoose');
const User = require('./backend/models/User');
const Question = require('./packages/shared/models/Question');
const Submission = require('./packages/shared/models/Submission');
const SubmissionService = require('./backend/services/submission.service');
const { SUBMISSION_STATUS } = require('./packages/shared/contracts/verdicts');
const Redis = require('ioredis');

const MONGO_URI = 'mongodb://localhost:27017/leetcode?authSource=admin';
const REDIS_URL = { host: 'localhost', port: 6379 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSubmission(submissionId, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const submission = await Submission.findById(submissionId).lean();
    if (submission && submission.status === SUBMISSION_STATUS.COMPLETED) {
      return submission;
    }
    await sleep(1000);
  }
  const fallback = await Submission.findById(submissionId).lean();
  return fallback;
}

async function createAndVerifyCase(language, variant) {
  const question = await Question.findOne({ slug: 'two-sum' });
  const user = await User.findOne({});
  const code = {
    javascript: {
      accepted: `function twoSum(nums, target) { const map = new Map(); for (let i = 0; i < nums.length; i++) { const diff = target - nums[i]; if (map.has(diff)) return [map.get(diff), i]; map.set(nums[i], i); } return []; }`,
      wrong: `function twoSum(nums, target) { return [0, 0]; }`,
      runtime: `function twoSum(nums, target) { const x = undefined; return x.y; }`,
      timeout: `function twoSum(nums, target) { while (true) {} }`,
      compileError: `function twoSum(nums, target) { return [0, 0]; }`,
    },
    python: {
      accepted: `class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, v in enumerate(nums):\n            diff = target - v\n            if diff in seen:\n                return [seen[diff], i]\n            seen[v] = i\n        return []`,
      wrong: `class Solution:\n    def twoSum(self, nums, target):\n        return [0, 0]`,
      runtime: `class Solution:\n    def twoSum(self, nums, target):\n        x = {}\n        return x['missing']`,
      timeout: `class Solution:\n    def twoSum(self, nums, target):\n        while True:\n            pass`,
      compileError: `class Solution:\n    def twoSum(self, nums, target):\n    return [0,0]`,
    },
    java: {
      accepted: `class Solution { public int[] twoSum(int[] nums, int target) { for (int i = 0; i < nums.length; i++) { for (int j = i + 1; j < nums.length; j++) { if (nums[i] + nums[j] == target) return new int[]{i, j}; } } return new int[]{-1, -1}; } }`,
      wrong: `class Solution { public int[] twoSum(int[] nums, int target) { return new int[]{0, 0}; } }`,
      runtime: `class Solution { public int[] twoSum(int[] nums, int target) { int[] x = null; return x; } }`,
      timeout: `class Solution { public int[] twoSum(int[] nums, int target) { while (true) {} } }`,
      compileError: `class Solution { public int[] twoSum(int[] nums, int target) { return new int[]{0, 0};`,
    }
  }[language][variant];

  const result = await SubmissionService.createSubmission({
    userId: user._id,
    questionId: question._id,
    language,
    code,
  });

  const submission = await waitForSubmission(result.submissionId, 120000);
  console.log(JSON.stringify({ description: `${language}:${variant}`, submissionId: String(submission._id), status: submission.status, verdict: submission.verdict, passedTestCases: submission.passedTestCases, totalTestCases: submission.totalTestCases, errorMessage: submission.errorMessage }, null, 2));
  return submission;
}

async function runConcurrency(language, count) {
  const question = await Question.findOne({ slug: 'two-sum' });
  const user = await User.findOne({});
  const baseCode = {
    javascript: `function twoSum(nums, target) { const map = new Map(); for (let i = 0; i < nums.length; i++) { const diff = target - nums[i]; if (map.has(diff)) return [map.get(diff), i]; map.set(nums[i], i); } return []; }`,
    python: `class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, v in enumerate(nums):\n            diff = target - v\n            if diff in seen:\n                return [seen[diff], i]\n            seen[v] = i\n        return []`,
    java: `class Solution { public int[] twoSum(int[] nums, int target) { for (int i = 0; i < nums.length; i++) { for (int j = i + 1; j < nums.length; j++) { if (nums[i] + nums[j] == target) return new int[]{i, j}; } } return new int[]{-1, -1}; } }`,
  }[language];

  const created = await Promise.all(Array.from({ length: count }, async () => {
    return SubmissionService.createSubmission({ userId: user._id, questionId: question._id, language, code: baseCode });
  }));

  const submissions = await Promise.all(created.map((entry) => waitForSubmission(entry.submissionId, 180000)));
  const summary = submissions.map((s) => ({ id: String(s._id), status: s.status, verdict: s.verdict, passedTestCases: s.passedTestCases, totalTestCases: s.totalTestCases, errorMessage: s.errorMessage }));
  console.log(JSON.stringify({ language, concurrency: count, results: summary }, null, 2));
  return submissions;
}

async function getActiveRedisCount() {
  const redis = new Redis(REDIS_URL);
  const value = await redis.get('koder:host:activeExecutions');
  await redis.quit();
  return Number(value || 0);
}

async function capacityGateScenario() {
  const question = await Question.findOne({ slug: 'two-sum' });
  const user = await User.findOne({});
  const code = `function twoSum(nums, target) { const map = new Map(); for (let i = 0; i < nums.length; i++) { const diff = target - nums[i]; if (map.has(diff)) return [map.get(diff), i]; map.set(nums[i], i); } return []; }`;
  const before = await getActiveRedisCount();

  const entries = await Promise.all(Array.from({ length: 5 }, async () => {
    return SubmissionService.createSubmission({ userId: user._id, questionId: question._id, language: 'javascript', code });
  }));

  const during = await getActiveRedisCount();
  console.log(JSON.stringify({ before, during, created: entries.map((e) => e.submissionId) }, null, 2));

  const results = await Promise.all(entries.map((entry) => waitForSubmission(entry.submissionId, 180000)));
  console.log(JSON.stringify({ capacityGateResults: results.map((s) => ({ id: String(s._id), status: s.status, verdict: s.verdict, errorMessage: s.errorMessage })) }, null, 2));
  const after = await getActiveRedisCount();
  console.log(JSON.stringify({ after }, null, 2));

  const containerCount = Number(execSync("docker ps -aq --filter name=koder-submission- | wc -l").toString().trim());
  console.log(JSON.stringify({ orphanContainerCount: containerCount }, null, 2));
}

(async () => {
  await mongoose.connect(MONGO_URI);
  console.log('MONGO_CONNECTED');

  const user = await User.findOne({});
  const question = await Question.findOne({ slug: 'two-sum' });
  console.log(JSON.stringify({ userId: String(user._id), questionId: String(question._id), questionSlug: question.slug }, null, 2));

  for (const [language, variants] of Object.entries({
    javascript: ['accepted', 'wrong', 'runtime', 'timeout'],
    python: ['accepted', 'wrong', 'runtime', 'timeout'],
    java: ['accepted', 'wrong', 'compileError', 'runtime', 'timeout'],
  })) {
    console.log('=== LANGUAGE ' + language.toUpperCase() + ' ===');
    for (const variant of variants) {
      try {
        await createAndVerifyCase(language, variant);
      } catch (err) {
        console.log(JSON.stringify({ language, variant, error: err.message }, null, 2));
      }
    }
  }

  console.log('=== CONCURRENCY TESTS ===');
  for (const [language, count] of [['javascript', 1], ['javascript', 2], ['javascript', 4], ['python', 1], ['python', 2], ['python', 4], ['java', 1], ['java', 2], ['java', 4]]) {
    try {
      await runConcurrency(language, count);
    } catch (err) {
      console.log(JSON.stringify({ language, count, error: err.message }, null, 2));
    }
  }

  console.log('=== CAPACITY GATE ===');
  await capacityGateScenario();

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('VALIDATION_FAIL', err);
  process.exit(1);
});
