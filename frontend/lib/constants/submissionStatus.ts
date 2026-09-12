import type { SubmissionStatus } from "@/types/api";

export const SUBMISSION_STATUSES = [
  "created",
  "queued",
  "running",
  "completed",
] as const satisfies readonly SubmissionStatus[];

export const SUBMISSION_STATUS_PRESENTATION: Record<
  (typeof SUBMISSION_STATUSES)[number],
  { label: string; className: string }
> = {
  created: {
    label: "Created",
    className: "bg-muted text-muted-foreground ring-border",
  },
  queued: {
    label: "Queued",
    className: "bg-sky-500/10 text-sky-400 ring-sky-500/20",
  },
  running: {
    label: "Running",
    className: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
  },
};

export function getSubmissionStatusPresentation(status: string) {
  return (
    SUBMISSION_STATUS_PRESENTATION[
      status as keyof typeof SUBMISSION_STATUS_PRESENTATION
    ] ?? SUBMISSION_STATUS_PRESENTATION.created
  );
}
