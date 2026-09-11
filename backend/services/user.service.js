const UserRepository = require("../repositories/user.repository");
const SubmissionRepository = require("../repositories/submission.repository");
const QuestionRepository = require("../repositories/question.repository");
const AppError = require("../errors/appError");

async function getProfile(userId) {
  const user = await UserRepository.findById(userId).select({ password: 0 });
  if (!user) {
    throw AppError.notFound("Invalid UserId");
  }
  return user;
}

async function getUserStats(userId) {
  const [summary, activityDays, recentSubmissions, recentlySolvedRows] = await Promise.all([
    SubmissionRepository.getUserStatsSummary(userId),
    SubmissionRepository.getUserActivityDays(userId),
    SubmissionRepository.findRecentForStats(userId, 5),
    SubmissionRepository.findRecentlySolvedForStats(userId, 5),
  ]);
  const totalSubmissions = summary.totalSubmissions;
  const acceptedSubmissions = summary.acceptedSubmissions;
  const solvedQuestions = new Set(summary.solvedQuestionIds.map((id) => String(id)));
  const attemptedQuestions = new Set(summary.attemptedQuestionIds.map((id) => String(id)));

  const questions = await QuestionRepository.findAllForStats();

  let solvedEasyQuestions = 0;
  let solvedMediumQuestions = 0;
  let solvedHardQuestions = 0;

  const availableByDifficulty = { Easy: 0, Medium: 0, Hard: 0 };
  for (const question of questions) {
    availableByDifficulty[question.difficulty]++;
    if (!solvedQuestions.has(question._id.toString())) continue;

    switch (question.difficulty) {
      case "Easy":
        solvedEasyQuestions++;
        break;
      case "Medium":
        solvedMediumQuestions++;
        break;
      case "Hard":
        solvedHardQuestions++;
        break;
      default:
        break;
    }
  }

  const acceptanceRate = totalSubmissions === 0
    ? 0
    : Number(((acceptedSubmissions / totalSubmissions) * 100).toFixed(2));

  const recentQuestionIds = new Set(recentSubmissions.map((submission) => String(submission.questionId)));
  const recentlySolvedQuestionIds = recentlySolvedRows.map((row) => String(row._id));
  const questionIds = [...new Set([...recentQuestionIds, ...recentlySolvedQuestionIds])];
  const recentQuestions = questions.filter((question) => questionIds.includes(String(question._id)));
  const questionsById = new Map(
    recentQuestions.map((question) => [question._id.toString(), question]),
  );

  const recentSubmissionResults = recentSubmissions.flatMap((submission) => {
    const question = questionsById.get(submission.questionId.toString());
    if (!question) return [];
    return [{
      question: {
        title: question.title,
        slug: question.slug,
        difficulty: question.difficulty,
      },
      language: submission.language,
      verdict: submission.verdict || submission.status,
      maxRuntime: submission.maxRuntime || 0,
      createdAt: submission.createdAt,
    }];
  });

  const recentlySolved = [];
  for (const row of recentlySolvedRows) {
    const questionId = String(row._id);
    const question = questionsById.get(questionId);
    if (!question) continue;
    recentlySolved.push({
      title: question.title,
      slug: question.slug,
      difficulty: question.difficulty,
      solvedAt: row.solvedAt,
    });
  }

  const submissionDays = activityDays.map((row) => row._id);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dayDifference = (from, to) => Math.round((from - to) / 86400000);
  let currentStreak = 0;
  let cursor = new Date(today);
  if (submissionDays[0]) {
    const lastActive = new Date(`${submissionDays[0]}T00:00:00.000Z`);
    if (dayDifference(cursor, lastActive) <= 1) {
      for (const day of submissionDays) {
        const activeDay = new Date(`${day}T00:00:00.000Z`);
        if (dayDifference(cursor, activeDay) !== 0) break;
        currentStreak++;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
    }
  }

  let longestStreak = 0;
  let runningStreak = 0;
  let previousDay = null;
  for (const day of [...submissionDays].reverse()) {
    const activeDay = new Date(`${day}T00:00:00.000Z`);
    if (!previousDay || dayDifference(activeDay, previousDay) === 1) {
      runningStreak++;
    } else {
      runningStreak = 1;
    }
    longestStreak = Math.max(longestStreak, runningStreak);
    previousDay = activeDay;
  }

  const weekStart = new Date(today);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const weeklyStats = await SubmissionRepository.getWeeklyStats(userId, weekStart);
  const weeklySolved = weeklyStats.solvedQuestionIds.length;
  const weeklyAttempted = weeklyStats.attemptedQuestionIds.length;

  const recommendationOrder = ["Easy", "Medium", "Hard"];
  const recommendedQuestion = recommendationOrder
    .map((difficulty) => questions.find((question) =>
      question.difficulty === difficulty && !solvedQuestions.has(question._id.toString()),
    ))
    .find(Boolean);

  return {
    totalSubmissions,
    solvedCount: solvedQuestions.size,
    attemptedCount: attemptedQuestions.size,
    attemptedButUnsolved: attemptedQuestions.size - solvedQuestions.size,
    acceptedSubmissions,
    acceptanceRate,
    solvedEasyQuestions,
    solvedMediumQuestions,
    solvedHardQuestions,
    availableByDifficulty,
    recentSubmissions: recentSubmissionResults,
    recentlySolved,
    activity: {
      currentStreak,
      longestStreak,
      lastActive: recentSubmissions[0]?.createdAt || null,
      weeklySolved,
      weeklyAttempted,
    },
    recommendation: recommendedQuestion
      ? {
        title: recommendedQuestion.title,
        slug: recommendedQuestion.slug,
        difficulty: recommendedQuestion.difficulty,
      }
      : null,
    solvedQuestions: [...solvedQuestions],
  };
}

module.exports = {
  getProfile,
  getUserStats,
};
