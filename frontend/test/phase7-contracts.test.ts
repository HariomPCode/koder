import { describe, expect, it, vi } from "vitest";
import { getContestLifecycleActions } from "@/features/admin/lifecycle";
import type { ContestStatus } from "@/types/api";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { useContestLeaderboardEvents } from "@/hooks/useContestLeaderboardEvents";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, (event: MessageEvent<string>) => void>();
  closed = false;
  constructor() { FakeEventSource.instances.push(this); }
  addEventListener(name: string, listener: (event: MessageEvent<string>) => void) { this.listeners.set(name, listener); }
  close() { this.closed = true; }
}

describe("Phase 7 backend-facing lifecycle contracts", () => {
  it.each<[ContestStatus, string[]]>([
    ["DRAFT", []],
    ["SCHEDULED", ["startContest"]],
    ["REGISTRATION", ["startContest"]],
    ["RUNNING", ["endContest"]],
    ["ENDED", ["finalizeContest"]],
    ["FINALIZED", []],
  ])("exposes only valid actions for %s contests", (status, expected) => {
    expect(getContestLifecycleActions(status)).toEqual(expected);
  });

  it("filters contest leaderboard events by contest id and cleans up", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const update = vi.fn();
    function Harness() { useContestLeaderboardEvents("contest-1", update); return null; }
    const { unmount } = render(createElement(Harness));
    const source = FakeEventSource.instances[0];
    source.listeners.get("message")?.({ data: JSON.stringify({ contestId: "other", event: "contest.lifecycle" }) } as MessageEvent<string>);
    source.listeners.get("message")?.({ data: JSON.stringify({ contestId: "contest-1", event: "contest.lifecycle" }) } as MessageEvent<string>);
    expect(update).toHaveBeenCalledTimes(1);
    unmount();
    expect(source.closed).toBe(true);
    vi.unstubAllGlobals();
  });
});
