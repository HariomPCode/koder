import { api } from "@/lib/api-client";
import type { User, UserStats } from "@/types/api";

export function getCurrentUser() {
  return api.get<{ user: User }>("/api/v1/user");
}

export function getUserStats() {
  return api.get<UserStats>("/api/v1/user/stats");
}
