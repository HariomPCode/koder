import { ApiError, api } from "@/lib/api-client";
import type {
  AdminQuestion,
  Contest,
  ContestProblemInput,
  Pagination,
  User,
} from "@/types/api";

export interface AdminContestResponse { contest: Contest }
export interface AdminContestListResponse { contests: Contest[]; pagination: Pagination }
export interface AdminQuestionListResponse { questions: AdminQuestion[]; pagination?: Pagination }
export interface AdminQuestionResponse { question: AdminQuestion; message?: string }
export interface AdminUserListResponse { users: User[]; pagination: Pagination }
export interface LeaderboardOperationResponse {
  status?: string;
  message?: string;
  [key: string]: unknown;
}

export const adminApi = {
  getContests: (page = 1, limit = 20) => api.get<AdminContestListResponse>(`/admin/contests?page=${page}&limit=${limit}`),
  getContest: (id: string) => api.get<AdminContestResponse>(`/admin/contests/${id}`),
  createContest: (body: Partial<Contest> & { problems: ContestProblemInput[] }) => api.post<AdminContestResponse>("/admin/contests", body),
  updateContest: (id: string, body: Partial<Contest> & { problems?: ContestProblemInput[] }) => api.patch<AdminContestResponse>(`/admin/contests/${id}`, body),
  startContest: (id: string) => api.post<AdminContestResponse>(`/admin/contests/${id}/start`),
  endContest: (id: string) => api.post<AdminContestResponse>(`/admin/contests/${id}/end`),
  finalizeContest: (id: string, body?: { force?: boolean; reason?: string }) => api.post<AdminContestResponse>(`/admin/contests/${id}/finalize`, body),
  getQuestions: async () => {
    try {
      return await api.get<AdminQuestionListResponse>("/admin/questions");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return { questions: [] };
      throw error;
    }
  },
  getQuestion: (id: string) => api.get<AdminQuestionResponse>(`/admin/questions/${id}`),
  createQuestion: (body: Partial<AdminQuestion>) => api.post<AdminQuestionResponse>("/admin/questions", body),
  updateQuestion: (id: string, body: Partial<AdminQuestion>) => api.put<AdminQuestionResponse>(`/admin/questions/${id}`, body),
  deleteQuestion: (id: string) => api.delete<{ message: string }>(`/admin/questions/${id}`),
  getUsers: (page = 1, limit = 20) => api.get<AdminUserListResponse>(`/admin/users?page=${page}&limit=${limit}`),
  rebuildLeaderboard: (id: string, reason: string) => api.post<LeaderboardOperationResponse>(`/admin/contests/${id}/leaderboard/rebuild`, { reason }),
  getLeaderboardHealth: (id: string) => api.get<LeaderboardOperationResponse>(`/admin/contests/${id}/leaderboard/health`),
  preseedLeaderboard: (id: string, reason: string) => api.post<LeaderboardOperationResponse>(`/admin/contests/${id}/leaderboard/preseed`, { reason }),
  cleanupLeaderboard: (id: string, reason: string) => api.post<LeaderboardOperationResponse>(`/admin/contests/${id}/leaderboard/cleanup`, { reason }),
};

export function getLeaderboardOperationError(error: unknown) {
  if (error instanceof ApiError) {
    const status = typeof error.body?.details === "object" && error.body.details && "status" in error.body.details ? String(error.body.details.status) : undefined;
    const bodyStatus = status ?? (error.body && "status" in error.body ? String(error.body.status) : undefined);
    if (bodyStatus === "already_running") return "A leaderboard operation is already running.";
    if (bodyStatus === "disabled") return "This leaderboard operation is disabled for the current contest state.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Leaderboard operation failed.";
}
