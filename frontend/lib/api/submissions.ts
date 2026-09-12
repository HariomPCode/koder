import { ApiError, api } from "@/lib/api-client";
import type { QuestionSubmissionsResponse } from "@/types/api";

export function getQuestionSubmissions(questionId: string) {
  return api.get<QuestionSubmissionsResponse>(
    `/api/v1/submissions/question/${questionId}`,
  );
}

export function getSubmissionErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return "An identical submission is already being processed";
  }
  return "Failed to submit solution";
}
