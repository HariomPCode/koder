import { api } from "@/lib/api-client";
import type { UserStats } from "@/types/api";

export function getUserStats() {
  return api.get<UserStats>("/api/v1/user/stats");
}
