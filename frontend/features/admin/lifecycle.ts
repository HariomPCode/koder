import type { ContestStatus } from "@/types/api";

export type ContestLifecycleAction = "startContest" | "endContest" | "finalizeContest";

export const CONTEST_LIFECYCLE_ACTIONS: Record<ContestStatus, ContestLifecycleAction[]> = {
  DRAFT: [],
  SCHEDULED: ["startContest"],
  REGISTRATION: ["startContest"],
  RUNNING: ["endContest"],
  ENDED: ["finalizeContest"],
  FINALIZED: [],
};

export function getContestLifecycleActions(status: ContestStatus) {
  return CONTEST_LIFECYCLE_ACTIONS[status];
}
