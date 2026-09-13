import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Signup from "@/app/(auth)/signup/page";
import Login from "@/app/(auth)/signin/page";
import Dashboard from "@/app/dashboard/page";
import ContestsPage from "@/app/contests/page";
import ContestDetailPage from "@/app/contests/[id]/page";
import ContestLeaderboardPage from "@/app/contests/[id]/leaderboard/page";
import AdminQuestionsPage from "@/app/admin/questions/page";
import { QuestionForm } from "@/features/admin/QuestionForm";
import { ProblemsClient } from "@/features/problems/ProblemsClient";
import SolveProblemClient from "@/features/workspace/SolveProblemClient";
import { api } from "@/lib/api-client";
import type { ProblemDetail, User } from "@/types/api";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  auth: {
    status: "authenticated" as "authenticated" | "unauthenticated" | "checking" | "error",
    user: { _id: "user-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", role: "user" as "user" | "admin" },
    refreshUser: vi.fn(),
    logout: vi.fn(),
  },
  contests: {
    getContests: vi.fn(),
    getContest: vi.fn(),
    registerForContest: vi.fn(),
    unregisterFromContest: vi.fn(),
    getContestStandings: vi.fn(),
    getMyContestStanding: vi.fn(),
  },
  admin: {
    getQuestions: vi.fn(),
    createQuestion: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => "/problems",
  useSearchParams: () => new URLSearchParams("page=1&limit=20"),
  useParams: () => ({ id: "contest-1" }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/api/contests", () => mocks.contests);
vi.mock("@/lib/api/admin", () => ({ adminApi: mocks.admin }));
vi.mock("@monaco-editor/react", () => ({ default: () => <div aria-label="Code editor" /> }));

const user: User = {
  _id: "user-1",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  role: "user",
  rating: 1200,
};

const stats = {
  totalSubmissions: 2,
  solvedCount: 1,
  attemptedCount: 1,
  attemptedButUnsolved: 0,
  acceptedSubmissions: 1,
  acceptanceRate: 50,
  solvedEasyQuestions: 1,
  solvedMediumQuestions: 0,
  solvedHardQuestions: 0,
  availableByDifficulty: { Easy: 2, Medium: 1, Hard: 1 },
  recentSubmissions: [],
  recentlySolved: [],
  activity: { currentStreak: 1, longestStreak: 2, lastActive: new Date().toISOString(), weeklySolved: 1, weeklyAttempted: 1 },
  recommendation: null,
  solvedQuestions: [],
};

const problem: ProblemDetail = {
  _id: "problem-1",
  questionNum: 1,
  title: "Two Sum",
  slug: "two-sum",
  difficulty: "Easy",
  tags: ["Array"],
  description: "Find two numbers.",
  constraints: [],
  sampleTestCases: [],
  starterCode: [{ language: "javascript", code: "function twoSum() {}" }],
};

const contest = {
  _id: "contest-1",
  title: "Spring Challenge",
  slug: "spring-challenge",
  description: "Solve problems.",
  registrationOpenTime: "2026-09-12T10:00:00.000Z",
  startTime: "2026-09-12T11:00:00.000Z",
  endTime: "2026-09-12T13:00:00.000Z",
  status: "REGISTRATION" as const,
  problems: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  mocks.auth.status = "authenticated";
  mocks.auth.user = { ...user };
});

describe("Phase 8 integration flows", () => {
  it("completes the authentication API flow through signup, signin, and signout", async () => {
    const get = vi.spyOn(api, "get");
    const post = vi.spyOn(api, "post");
    get.mockResolvedValue({ user });
    post.mockResolvedValue({ message: "ok", user });
    mocks.auth.refreshUser.mockResolvedValue(true);

    mocks.auth.status = "unauthenticated";
    const signup = render(<Signup />);
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Lovelace" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/auth/signup", expect.objectContaining({ email: user.email })));

    signup.unmount();
    mocks.auth.status = "unauthenticated";
    render(<Login />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/auth/signin", expect.objectContaining({ email: user.email })));
    await mocks.auth.logout();
    expect(mocks.auth.logout).toHaveBeenCalled();
  });

  it("browses, opens, edits, submits, and receives a completed verdict", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ submissionId: "submission-1" });
    vi.spyOn(api, "get").mockResolvedValue({ submission: { _id: "submission-1", status: "completed", verdict: "Accepted", language: "javascript", passedTestCases: 2, totalTestCases: 2, maxRuntime: 1 } });
    render(<ProblemsClient initialProblems={[problem]} />);
    expect(screen.getByRole("link", { name: /Two Sum/i })).toHaveAttribute("href", "/problems/two-sum");
    render(<SolveProblemClient problem={problem} slug="two-sum" />);
    const editor = screen.getByLabelText("Code editor");
    expect(editor).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/submissions/problem-1", expect.objectContaining({ language: "javascript" })));
  });

  it.each([
    ["fresh", { ...stats, solvedCount: 0, acceptedSubmissions: 0, totalSubmissions: 0 }],
    ["active", stats],
  ])("renders %s dashboard statistics", async (_label, response) => {
    vi.spyOn(api, "get").mockResolvedValue(response);
    render(<Dashboard />);
    await waitFor(() => {
      const solvedCard = screen.getByText("Solved", { exact: true }).parentElement;
      expect(solvedCard).not.toBeNull();
      expect(within(solvedCard as HTMLElement).getByText(String(response.solvedCount), { exact: true })).toBeInTheDocument();
    });
  });

  it("registers for a contest and renders its leaderboard", async () => {
    mocks.contests.getContests.mockResolvedValue({ contests: [contest] });
    mocks.contests.getContest.mockResolvedValue({ contest, registered: false });
    mocks.contests.registerForContest.mockResolvedValue({ registered: true });
    mocks.contests.getContestStandings.mockResolvedValue({ standings: [{ userId: "user-1", rank: 1, score: 100, penalty: 0, solvedCount: 1 }], pagination: { page: 1, limit: 50, total: 1, totalPages: 1 } });
    mocks.contests.getMyContestStanding.mockResolvedValue({ standing: null });
    render(<ContestsPage />);
    await screen.findByText("Spring Challenge");
    render(<ContestDetailPage />);
    await screen.findByRole("button", { name: "Register" });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => expect(mocks.contests.registerForContest).toHaveBeenCalledWith("contest-1"));
    render(<ContestLeaderboardPage />);
    await waitFor(() => expect(screen.getByText("Leaderboard")).toBeInTheDocument());
    expect(screen.getAllByText("1", { exact: true }).length).toBeGreaterThan(0);
  });

  it("creates a question and shows it in the admin list while gating non-admin fetches", async () => {
    mocks.auth.user = { ...user, role: "admin" };
    mocks.admin.createQuestion.mockResolvedValue({ question: { _id: "question-1" } });
    mocks.admin.getQuestions.mockResolvedValue({ questions: [{ _id: "question-1", title: "Two Sum", slug: "two-sum", difficulty: "Easy", description: "", constraints: [], sampleTestCases: [], hiddenTestCases: [], tags: [], functionName: "twoSum", parameters: [], returnType: "int[]", starterCode: [] }] });
    render(<QuestionForm onSaved={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Two Sum" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Find a pair." } });
    fireEvent.change(screen.getByLabelText("Function name"), { target: { value: "twoSum" } });
    fireEvent.click(screen.getByRole("button", { name: "Create question" }));
    await waitFor(() => expect(mocks.admin.createQuestion).toHaveBeenCalled());
    render(<AdminQuestionsPage />);
    await waitFor(() => expect(screen.getByText("Two Sum")).toBeInTheDocument());
    mocks.auth.user = { ...user, role: "user" };
    mocks.admin.getQuestions.mockClear();
    render(<AdminQuestionsPage />);
    expect(mocks.admin.getQuestions).not.toHaveBeenCalled();
  });
});
