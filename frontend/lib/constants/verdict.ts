import type { Verdict } from "@/types/api";

export const VERDICTS = [
  "Accepted",
  "Wrong Answer",
  "Time Limit Exceeded",
  "Memory Limit Exceeded",
  "Runtime Error",
  "Compilation Error",
] as const satisfies readonly Verdict[];

export type VerdictPresentationKey = Verdict | "pending";

export const VERDICT_PRESENTATION: Record<
  VerdictPresentationKey,
  { className: string; label: string }
> & Record<string, { className: string; label: string }> = {
  Accepted: {
    className: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
    label: "Accepted",
  },
  "Wrong Answer": {
    className: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
    label: "Wrong Answer",
  },
  "Time Limit Exceeded": {
    className: "bg-orange-500/10 text-orange-400 ring-orange-500/20",
    label: "Time Limit Exceeded",
  },
  "Memory Limit Exceeded": {
    className: "bg-orange-500/10 text-orange-400 ring-orange-500/20",
    label: "Memory Limit Exceeded",
  },
  "Runtime Error": {
    className: "bg-rose-500/10 text-rose-400 ring-rose-500/20",
    label: "Runtime Error",
  },
  "Compilation Error": {
    className: "bg-rose-500/10 text-rose-400 ring-rose-500/20",
    label: "Compilation Error",
  },
  pending: {
    className: "bg-muted text-muted-foreground ring-border",
    label: "Pending",
  },
};

export function getVerdictPresentation(verdict?: string) {
  return (
    VERDICT_PRESENTATION[verdict as VerdictPresentationKey] ??
    VERDICT_PRESENTATION.pending
  );
}
