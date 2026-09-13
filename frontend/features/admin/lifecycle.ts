import type { ContestStatus } from "@/types/api";

export type ContestLifecycleAction =
  | "scheduleContest"
  | "startContest"
  | "endContest"
  | "finalizeContest";

export const CONTEST_LIFECYCLE_ACTIONS: Record<ContestStatus, ContestLifecycleAction[]> = {
  DRAFT: ["scheduleContest"],
  SCHEDULED: ["startContest"],
  REGISTRATION: ["startContest"],
  RUNNING: ["endContest"],
  ENDED: ["finalizeContest"],
  FINALIZED: [],
};

export function getContestLifecycleActions(status: ContestStatus) {
  return CONTEST_LIFECYCLE_ACTIONS[status];
}
