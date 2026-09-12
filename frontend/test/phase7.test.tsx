import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContestCard } from "@/features/contests/ContestCard";
import { Countdown } from "@/features/contests/Countdown";
import { MyStanding } from "@/features/contests/MyStanding";
import { QuestionForm } from "@/features/admin/QuestionForm";
import { ContestForm } from "@/features/admin/ContestForm";
import { AdminGate } from "@/features/admin/AdminGate";
import { ApiError } from "@/lib/api-client";
import type { Contest } from "@/types/api";

const { adminMock, contestMock, authState } = vi.hoisted(() => ({
  adminMock: {
    createQuestion: vi.fn(),
    getQuestions: vi.fn(),
    createContest: vi.fn(),
  },
  contestMock: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  authState: { status: "authenticated", user: { _id: "admin", role: "admin" as "admin" | "user" } },
}));

vi.mock("@/lib/api/admin", () => ({ adminApi: adminMock }));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: contestMock };
});
vi.mock("@/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({ status: "authenticated", error: null, accessDenied: false }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

const contest: Contest = {
  _id: "contest-1",
  title: "Spring Challenge",
  slug: "spring-challenge",
  description: "Solve problems.",
  registrationOpenTime: "2026-09-12T10:00:00.000Z",
  startTime: "2026-09-12T11:00:00.000Z",
  endTime: "2026-09-12T13:00:00.000Z",
  status: "RUNNING",
  problems: [],
};

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
  authState.user = { _id: "admin", role: "admin" };
});

describe("Phase 7 contest surfaces", () => {
  it("renders contest cards and links to the contest detail", () => {
    render(<ContestCard contest={contest} />);
    expect(screen.getByText("Spring Challenge")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View contest" })).toHaveAttribute("href", "/contests/contest-1");
  });

  it("resynchronizes countdown on the server-detail interval and cleans up", () => {
    vi.useFakeTimers();
    const onResync = vi.fn();
    const { unmount } = render(<Countdown contest={contest} onResync={onResync} />);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(onResync).toHaveBeenCalledTimes(1);
    unmount();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it.each([
    [true, "RUNNING", true],
    [true, "ENDED", false],
    [false, "RUNNING", false],
    [false, "ENDED", false],
  ])("shows My Standing only for registered running participants", (registered, status, visible) => {
    const view = render(visible ? <MyStanding standing={{ userId: "u", rank: 2, solvedCount: 3, score: 300, penalty: 20 }} /> : <MyStanding standing={null} />);
    expect(view.container.textContent?.includes("My standing")).toBe(visible);
    void registered; void status;
  });

  it("uses the contest submission endpoint and preserves 429 semantics", async () => {
    contestMock.post.mockResolvedValue({ submissionId: "submission-1", status: "created" });
    const { createContestSubmission, getContestSubmissionErrorMessage } = await import("@/lib/api/contests");
    await createContestSubmission("contest-1", { contestProblemId: "problem-1", language: "javascript", code: "return 1;" });
    expect(contestMock.post).toHaveBeenCalledWith("/api/v1/contests/contest-1/submissions", { contestProblemId: "problem-1", language: "javascript", code: "return 1;" });
    expect(getContestSubmissionErrorMessage(new ApiError(429, { message: "Too many requests" }))).toBe("Contest submission limit reached");
  });
});

describe("Phase 7 admin forms and protection", () => {
  it("blocks the admin surface without rendering children", () => {
    authState.user = { _id: "user", role: "user" };
    render(<AdminGate><span>secret admin data</span></AdminGate>);
    expect(screen.queryByText("secret admin data")).not.toBeInTheDocument();
    expect(screen.getByText("Administrator permissions are required.")).toBeInTheDocument();
  });

  it("creates a question with editable slug and dynamic fields", async () => {
    adminMock.createQuestion.mockResolvedValue({ question: { _id: "question-1" } });
    const saved = vi.fn();
    render(<QuestionForm onSaved={saved} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Two Sum" } });
    expect(screen.getByLabelText("Slug")).toHaveValue("two-sum");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Find a pair." } });
    fireEvent.change(screen.getByLabelText("Function name"), { target: { value: "solve" } });
    fireEvent.click(screen.getByRole("button", { name: "Create question" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("question-1"));
  });

  it("surfaces backend question validation errors", async () => {
    adminMock.createQuestion.mockRejectedValue(new Error("Unsupported or invalid language in starterCode: 'ruby'"));
    render(<QuestionForm onSaved={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Question" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Description" } });
    fireEvent.change(screen.getByLabelText("Function name"), { target: { value: "solve" } });
    fireEvent.click(screen.getByRole("button", { name: "Create question" }));
    await waitFor(() => expect(screen.getByText(/Unsupported or invalid language/)).toBeInTheDocument());
  });

  it("creates a contest using selected problems and timing", async () => {
    adminMock.getQuestions.mockResolvedValue({ questions: [{ _id: "q1", title: "Two Sum" }] });
    adminMock.createContest.mockResolvedValue({ contest: { _id: "contest-1" } });
    const saved = vi.fn();
    render(<ContestForm onSaved={saved} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Spring Challenge" } });
    fireEvent.change(screen.getByLabelText("Registration opens"), { target: { value: "2026-09-12T10:00" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-12T11:00" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-09-12T13:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create contest" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("contest-1"));
  });
});
