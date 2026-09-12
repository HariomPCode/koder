import { useEffect } from "react";

export function useContestLeaderboardEvents(
  contestId: string,
  onUpdate: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || typeof window.EventSource !== "function") return undefined;
    const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/+$/, "") ?? "";
    const source = new EventSource(`${baseUrl}/api/v1/events/stream`, { withCredentials: true });
    const handleEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { contestId?: string; event?: string };
        if (payload.contestId === contestId && (!payload.event || payload.event === "contest.lifecycle" || payload.event.startsWith("submission."))) onUpdate();
      } catch {
        return;
      }
    };
    source.addEventListener("contest.lifecycle", handleEvent);
    source.addEventListener("message", handleEvent);
    ["submission.created", "submission.queued", "submission.running", "submission.completed"].forEach((name) => source?.addEventListener(name, handleEvent));
    return () => source.close();
  }, [contestId, enabled, onUpdate]);
}
