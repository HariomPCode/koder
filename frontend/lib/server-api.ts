import type { ProblemDetail, ProblemListItem, QuestionsResponse } from "@/types/api";

function getBackendUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!baseUrl) throw new Error("NEXT_PUBLIC_BACKEND_URL is not configured");
  return baseUrl.replace(/\/+$/, "");
}

async function serverGet<T>(path: string) {
  const response = await fetch(`${getBackendUrl()}${path}`, { cache: "no-store" });
  const body = (await response.json()) as T;
  if (!response.ok) throw new Error(
    body && typeof body === "object" && "message" in body
      ? String((body as { message?: unknown }).message)
      : `Request failed with status ${response.status}`,
  );
  return body;
}

export function getInitialQuestions(page = 1, limit = 20) {
  return serverGet<QuestionsResponse>(`/api/v1/questions?page=${page}&limit=${limit}`);
}

export function getInitialQuestion(slug: string) {
  return serverGet<{ question?: ProblemDetail }>(`/api/v1/questions/${encodeURIComponent(slug)}`);
}

export type InitialProblemData = {
  questions: ProblemListItem[];
};
