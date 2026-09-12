import type { AuthResponse } from "@/types/api";

const SUCCESS_MESSAGES = new Set([
  "User signed in successfully",
  "User Created Successfully",
]);

export function isSuccessfulAuthResponse(
  response: AuthResponse | null | undefined,
): boolean {
  return Boolean(response?.message && SUCCESS_MESSAGES.has(response.message));
}

export function getSafeNextPath(search: string): string {
  const next = new URLSearchParams(search).get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}
