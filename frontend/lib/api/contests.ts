import { ApiError, api } from "@/lib/api-client";
import type {
  ContestDetailResponse,
  ContestListResponse,
  ContestProblemsResponse,
  ContestStandingsResponse,
  ContestSubmissionCreateResponse,
  MyStandingResponse,
  Pagination,
  Submission,
} from "@/types/api";

export function getContests(page = 1, limit = 20) {
  return api.get<ContestListResponse>(`/api/v1/contests?page=${page}&limit=${limit}`);
}

export function getContest(contestId: string) {
  return api.get<ContestDetailResponse>(`/api/v1/contests/${contestId}`);
}

export function registerForContest(contestId: string) {
  return api.post<{ registered: boolean }>(`/api/v1/contests/${contestId}/register`);
}

export function unregisterFromContest(contestId: string) {
  return api.delete<{ removed: boolean }>(`/api/v1/contests/${contestId}/register`);
}

export function getContestProblems(contestId: string) {
  return api.get<ContestProblemsResponse>(`/api/v1/contests/${contestId}/problems`);
}

export function createContestSubmission(
  contestId: string,
  body: { contestProblemId: string; language: string; code: string },
) {
  return api.post<ContestSubmissionCreateResponse>(
    `/api/v1/contests/${contestId}/submissions`,
    body,
  );
}

export function getContestSubmissions(contestId: string, page = 1, limit = 20) {
  return api.get<{
    submissions: Submission[];
    pagination: Pagination;
  }>(`/api/v1/contests/${contestId}/submissions?page=${page}&limit=${limit}`);
}

export function getContestStandings(contestId: string, page = 1, limit = 50) {
  return api.get<ContestStandingsResponse>(
    `/api/v1/contests/${contestId}/standings?page=${page}&limit=${limit}`,
  );
}

export function getMyContestStanding(contestId: string) {
  return api.get<MyStandingResponse>(`/api/v1/contests/${contestId}/standings/me`);
}

export function getContestSubmissionErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 429) {
    return "Contest submission limit reached";
  }
  if (error instanceof ApiError) return error.message;
  return "Unable to submit to the contest";
}
