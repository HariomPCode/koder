export type Difficulty = "Easy" | "Medium" | "Hard";

export type SupportedLanguage = "javascript" | "java" | "python";

export type SubmissionStatus =
  | "created"
  | "queued"
  | "pending"
  | "running"
  | "completed";

export type Verdict =
  | "Accepted"
  | "Wrong Answer"
  | "Compilation Error"
  | "Runtime Error"
  | "Time Limit Exceeded"
  | "Memory Limit Exceeded";

export interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "user" | "admin";
  rating?: number;
  highestRating?: number;
  contestsParticipated?: number;
}

export interface AuthResponse {
  message: string;
}

export interface TestCase {
  input: string;
  output: string;
}

export interface StarterCode {
  language: SupportedLanguage | string;
  code: string;
}

export interface ProblemListItem {
  _id: string;
  questionNum: number;
  title: string;
  slug: string;
  difficulty: Difficulty;
  tags: string[];
}

export interface ProblemDetail extends ProblemListItem {
  description: string;
  constraints: string[];
  sampleTestCases: TestCase[];
  starterCode: StarterCode[];
}

export interface FailedTestCase {
  input?: string;
  expected?: string;
  received?: string;
}

export interface Submission {
  _id?: string;
  status: SubmissionStatus;
  verdict: Verdict | string;
  language?: SupportedLanguage | string;
  passedTestCases?: number;
  totalTestCases?: number;
  maxRuntime?: number;
  memory?: number;
  failedTestCase?: FailedTestCase | null;
  errorMessage?: string | null;
  createdAt?: string;
}

export interface SubmissionCreateResponse {
  submissionId: string;
  status: "processing" | SubmissionStatus | string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorBody {
  message?: string;
  details?: unknown;
}

export interface RecentSubmission {
  question: Pick<ProblemListItem, "title" | "slug" | "difficulty">;
  language: string;
  verdict: Verdict | string;
  maxRuntime: number;
  createdAt: string;
}

export interface UserStats {
  totalSubmissions: number;
  solvedCount: number;
  attemptedCount: number;
  attemptedButUnsolved: number;
  acceptedSubmissions: number;
  acceptanceRate: number;
  solvedEasyQuestions: number;
  solvedMediumQuestions: number;
  solvedHardQuestions: number;
  availableByDifficulty: Record<Difficulty, number>;
  recentSubmissions: RecentSubmission[];
  recentlySolved: Array<
    Pick<ProblemListItem, "title" | "slug" | "difficulty"> & { solvedAt: string }
  >;
  activity: {
    currentStreak: number;
    longestStreak: number;
    lastActive: string | null;
    weeklySolved: number;
    weeklyAttempted: number;
  };
  recommendation: Pick<ProblemListItem, "title" | "slug" | "difficulty"> | null;
  solvedQuestions: string[];
}

export interface QuestionsResponse {
  message: string;
  questions: ProblemListItem[];
}

export interface QuestionResponse {
  message: string;
  question: ProblemDetail;
}

export interface SubmissionResponse {
  submission: Submission;
}

export interface QuestionSubmissionsResponse {
  message?: string;
  submissions?: Submission[];
}
