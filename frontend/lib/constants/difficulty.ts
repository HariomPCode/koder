import type { Difficulty } from "@/types/api";

export const DIFFICULTIES = ["Easy", "Medium", "Hard"] as const satisfies readonly Difficulty[];

export const DIFFICULTY_PRESENTATION: Record<
  Difficulty,
  { badge: string; progress: string }
> = {
  Easy: {
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    progress: "bg-emerald-500",
  },
  Medium: {
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    progress: "bg-amber-500",
  },
  Hard: {
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-400",
    progress: "bg-rose-500",
  },
};
