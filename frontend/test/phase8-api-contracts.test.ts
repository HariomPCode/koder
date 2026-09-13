import { describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/lib/api-client";
import {
  adminApi,
  getLeaderboardOperationError,
} from "@/lib/api/admin";
import {
  createContestSubmission,
  getContest,
  getContestProblems,
  getContestStandings,
  getContestSubmissionErrorMessage,
  getContestSubmissions,
  getContests,
  getMyContestStanding,
  registerForContest,
  unregisterFromContest,
} from "@/lib/api/contests";
import {
  getQuestionSubmissions,
  getSubmissionErrorMessage,
} from "@/lib/api/submissions";
import { getCurrentUser, getUserStats } from "@/lib/api/user";
import {
  getSubmissionStatusPresentation,
  SUBMISSION_STATUSES,
} from "@/lib/constants/submissionStatus";
import {
  getVerdictPresentation,
  VERDICTS,
} from "@/lib/constants/verdict";

describe("Phase 8 API contracts", () => {
  it("routes user and submission requests through the typed client", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({} as never);

    await getCurrentUser();
    await getUserStats();
    await getQuestionSubmissions("question-1");

    expect(get).toHaveBeenNthCalledWith(1, "/api/v1/user");
    expect(get).toHaveBeenNthCalledWith(2, "/api/v1/user/stats");
    expect(get).toHaveBeenNthCalledWith(
      3,
      "/api/v1/submissions/question/question-1",
    );
    get.mockRestore();
  });

  it("builds contest request paths, query defaults, and submission bodies", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({} as never);
    const post = vi.spyOn(api, "post").mockResolvedValue({} as never);
    const del = vi.spyOn(api, "delete").mockResolvedValue({} as never);

    await getContests();
    await getContest("contest-1");
    await registerForContest("contest-1");
    await unregisterFromContest("contest-1");
    await getContestProblems("contest-1");
    await createContestSubmission("contest-1", {
      contestProblemId: "problem-1",
      language: "javascript",
      code: "return 1;",
    });
    await getContestSubmissions("contest-1");
    await getContestStandings("contest-1");
    await getMyContestStanding("contest-1");

    expect(get).toHaveBeenCalledWith("/api/v1/contests?page=1&limit=20");
    expect(get).toHaveBeenCalledWith("/api/v1/contests/contest-1");
    expect(post).toHaveBeenCalledWith("/api/v1/contests/contest-1/register");
    expect(del).toHaveBeenCalledWith("/api/v1/contests/contest-1/register");
    expect(post).toHaveBeenCalledWith(
      "/api/v1/contests/contest-1/submissions",
      {
        contestProblemId: "problem-1",
        language: "javascript",
        code: "return 1;",
      },
    );
    expect(get).toHaveBeenCalledWith(
      "/api/v1/contests/contest-1/submissions?page=1&limit=20",
    );
    expect(get).toHaveBeenCalledWith(
      "/api/v1/contests/contest-1/standings?page=1&limit=50",
    );
    expect(get).toHaveBeenCalledWith(
      "/api/v1/contests/contest-1/standings/me",
    );
  });

  it("normalizes admin question absence and exposes operation errors", async () => {
    const get = vi.spyOn(api, "get");
    get.mockRejectedValueOnce(new ApiError(404, { message: "missing" }));
    await expect(adminApi.getQuestions()).resolves.toEqual({ questions: [] });

    get.mockRejectedValueOnce(new ApiError(500, { message: "missing" }));
    await expect(
      adminApi.getQuestions(),
    ).rejects.toThrow("missing");

    expect(
      getLeaderboardOperationError(
        new ApiError(409, {
          message: "busy",
          details: { status: "already_running" },
        }),
      ),
    ).toBe("A leaderboard operation is already running.");
    expect(
      getLeaderboardOperationError(
        new ApiError(409, {
          message: "disabled",
          details: { status: "disabled" },
        }),
      ),
    ).toBe("This leaderboard operation is disabled for the current contest state.");
    expect(getLeaderboardOperationError(new Error("network"))).toBe("network");
    expect(getLeaderboardOperationError("unknown")).toBe(
      "Leaderboard operation failed.",
    );
  });

  it("maps submission and contest errors without hiding unknown failures", () => {
    expect(
      getSubmissionErrorMessage(new ApiError(409, { message: "duplicate" })),
    ).toBe("An identical submission is already being processed");
    expect(getSubmissionErrorMessage(new Error("network"))).toBe(
      "Failed to submit solution",
    );
    expect(
      getContestSubmissionErrorMessage(
        new ApiError(429, { message: "limited" }),
      ),
    ).toBe("Contest submission limit reached");
    expect(
      getContestSubmissionErrorMessage(
        new ApiError(500, { message: "server failed" }),
      ),
    ).toBe("server failed");
    expect(getContestSubmissionErrorMessage("unknown")).toBe(
      "Unable to submit to the contest",
    );
  });

  it("covers stable status and verdict presentation fallbacks", () => {
    expect(SUBMISSION_STATUSES).toEqual([
      "created",
      "queued",
      "running",
      "completed",
    ]);
    expect(getSubmissionStatusPresentation("running").label).toBe("Running");
    expect(getSubmissionStatusPresentation("unknown").label).toBe("Created");
    expect(VERDICTS).toContain("Accepted");
    expect(getVerdictPresentation("Accepted").label).toBe("Accepted");
    expect(getVerdictPresentation("unknown").label).toBe("Pending");
  });
});
