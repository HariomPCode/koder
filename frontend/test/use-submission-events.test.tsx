import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSubmissionEvents } from "@/hooks/useSubmissionEvents";
import type { Submission } from "@/types/api";

const { get } = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  api: { get },
}));

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: MockEventSource[] = [];
  readonly url: string;
  readonly listeners = new Map<string, EventListener[]>();
  readyState = MockEventSource.CONNECTING;
  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data = "") {
    if (type === "open") this.readyState = MockEventSource.OPEN;
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }
}

function SubmissionProbe({
  submissionId = "submission-1",
  onUpdate = vi.fn(),
  onError = vi.fn(),
}: {
  submissionId?: string | null;
  onUpdate?: (submission: Submission) => void;
  onError?: (message: string) => void;
}) {
  const { isPollingFallback } = useSubmissionEvents({
    submissionId,
    onSubmissionUpdate: onUpdate,
    onPollingError: onError,
  });
  return <output data-testid="fallback">{String(isPollingFallback)}</output>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  MockEventSource.instances = [];
  delete (window as Window & { EventSource?: typeof EventSource }).EventSource;
});

describe("useSubmissionEvents", () => {
  it("connects to SSE and processes only matching submission events", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const onUpdate = vi.fn();
    const completed: Submission = {
      _id: "submission-1",
      status: "completed",
      verdict: "Accepted",
    };
    get.mockResolvedValue({ submission: completed });

    render(<SubmissionProbe onUpdate={onUpdate} />);
    const source = MockEventSource.instances[0];

    expect(source.url).toContain("/api/v1/events/stream");
    source.emit(
      "submission.completed",
      JSON.stringify({ submissionId: "other", status: "completed" }),
    );
    expect(get).not.toHaveBeenCalled();

    source.emit(
      "submission.completed",
      JSON.stringify({ submissionId: "submission-1", status: "completed" }),
    );
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(completed));
    expect(source.close).toHaveBeenCalled();
  });

  it("ignores non-submission events and cleans up on unmount", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const { unmount } = render(<SubmissionProbe />);
    const source = MockEventSource.instances[0];

    source.emit("contest.lifecycle", JSON.stringify({ submissionId: "submission-1" }));
    expect(get).not.toHaveBeenCalled();

    unmount();
    expect(source.close).toHaveBeenCalled();
  });

  it("does not start polling after SSE opens successfully", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    get.mockResolvedValue({
      submission: { status: "running", verdict: "" },
    });

    render(<SubmissionProbe />);
    const source = MockEventSource.instances[0];
    source.emit("open");
    await vi.advanceTimersByTimeAsync(3000);

    expect(get).not.toHaveBeenCalled();
  });

  it("falls back to bounded polling when EventSource is unavailable", async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    const onError = vi.fn();
    get.mockRejectedValue(new Error("network"));

    render(<SubmissionProbe onUpdate={onUpdate} onError={onError} />);
    expect(screen.getByTestId("fallback")).toHaveTextContent("true");

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await vi.runOnlyPendingTimersAsync();
    }

    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(
      "Unable to update the submission result. Please refresh and try again.",
    );
    expect(get).toHaveBeenCalledTimes(6);
  });

  it("pauses fallback polling while hidden and resumes on visibility", async () => {
    vi.useFakeTimers();
    const submissions: Submission[] = [
      { status: "running", verdict: "" },
      { status: "completed", verdict: "Accepted" },
    ];
    get.mockImplementation(() =>
      Promise.resolve({ submission: submissions.shift() }),
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    render(<SubmissionProbe />);
    await vi.runOnlyPendingTimersAsync();
    expect(get).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", { value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(1);
  });
});
