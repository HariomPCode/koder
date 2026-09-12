import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api-client";
import type { Submission, SubmissionResponse } from "@/types/api";

const EVENTS_PATH = "/api/v1/events/stream";
const CONNECTION_TIMEOUT_MS = 1500;
const MAX_POLL_ATTEMPTS = 6;
const INITIAL_POLL_DELAY_MS = 1000;
const MAX_POLL_DELAY_MS = 8000;

type SubmissionEventPayload = {
  event?: string;
  submissionId?: string;
  status?: string;
  verdict?: string;
};

interface UseSubmissionEventsOptions {
  submissionId: string | null;
  onSubmissionUpdate: (submission: Submission) => void;
  onTerminal?: (submission: Submission) => void;
  onPollingError?: (message: string) => void;
}

function getEventsUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/+$/, "");
  return `${baseUrl ?? ""}${EVENTS_PATH}`;
}

function isTerminal(submission: Submission) {
  return submission.status === "completed";
}

export function useSubmissionEvents({
  submissionId,
  onSubmissionUpdate,
  onTerminal,
  onPollingError,
}: UseSubmissionEventsOptions) {
  const updateRef = useRef(onSubmissionUpdate);
  const terminalRef = useRef(onTerminal);
  const pollingErrorRef = useRef(onPollingError);
  const [isPollingFallback, setIsPollingFallback] = useState(false);

  useEffect(() => {
    updateRef.current = onSubmissionUpdate;
    terminalRef.current = onTerminal;
    pollingErrorRef.current = onPollingError;
  }, [onSubmissionUpdate, onTerminal, onPollingError]);

  useEffect(() => {
    if (!submissionId) {
      return undefined;
    }

    let active = true;
    let source: EventSource | null = null;
    let connectionTimer: number | null = null;
    let fallbackTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let visibilityListenerAttached = false;
    let polling = false;
    let pollInFlight = false;
    let pollAttempts = 0;
    let terminal = false;

    const clearTimer = (timer: number | null) => {
      if (timer !== null) window.clearTimeout(timer);
    };

    const clearTimers = () => {
      clearTimer(connectionTimer);
      clearTimer(fallbackTimer);
      clearTimer(reconnectTimer);
      connectionTimer = null;
      fallbackTimer = null;
      reconnectTimer = null;
    };

    const removeVisibilityListener = () => {
      if (!visibilityListenerAttached) return;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      visibilityListenerAttached = false;
    };

    const cleanup = () => {
      active = false;
      terminal = true;
      clearTimers();
      removeVisibilityListener();
      source?.close();
      source = null;
    };

    const finishWithSubmission = (submission: Submission) => {
      if (!active) return;
      updateRef.current(submission);
      if (isTerminal(submission)) {
        terminal = true;
        polling = false;
        clearTimers();
        removeVisibilityListener();
        source?.close();
        source = null;
        setIsPollingFallback(false);
        terminalRef.current?.(submission);
      }
    };

    const fetchSubmission = async () => {
      if (!active || terminal) return false;
      try {
        const response = await api.get<SubmissionResponse>(
          `/api/v1/submissions/${submissionId}`,
        );
        if (!active) return true;
        finishWithSubmission(response.submission);
        return true;
      } catch {
        return false;
      }
    };

    const schedulePoll = (delay: number) => {
      if (!active || terminal || !polling || document.visibilityState === "hidden") {
        return;
      }
      clearTimer(fallbackTimer);
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = null;
        void runPoll();
      }, delay);
    };

    const runPoll = async () => {
      if (
        !active ||
        terminal ||
        !polling ||
        pollInFlight ||
        document.visibilityState === "hidden"
      ) {
        return;
      }

      pollInFlight = true;
      pollAttempts += 1;
      const succeeded = await fetchSubmission();
      pollInFlight = false;

      if (!active || terminal || !polling) return;
      if (succeeded) {
        pollAttempts = 0;
        schedulePoll(INITIAL_POLL_DELAY_MS);
        return;
      }

      if (pollAttempts >= MAX_POLL_ATTEMPTS) {
        polling = false;
        clearTimer(fallbackTimer);
        removeVisibilityListener();
        setIsPollingFallback(false);
        pollingErrorRef.current?.(
          "Unable to update the submission result. Please refresh and try again.",
        );
        return;
      }

      const delay = Math.min(
        INITIAL_POLL_DELAY_MS * 2 ** (pollAttempts - 1),
        MAX_POLL_DELAY_MS,
      );
      schedulePoll(delay);
    };

    function handleVisibilityChange() {
      if (!active || terminal || !polling) return;
      if (document.visibilityState === "hidden") {
        clearTimer(fallbackTimer);
        fallbackTimer = null;
        return;
      }
      if (!pollInFlight) schedulePoll(0);
    }

    const startPolling = () => {
      if (!active || terminal || polling) return;
      polling = true;
      setIsPollingFallback(true);
      if (!visibilityListenerAttached) {
        document.addEventListener("visibilitychange", handleVisibilityChange);
        visibilityListenerAttached = true;
      }
      schedulePoll(0);
    };

    const handlePayload = (eventName: string, rawData: string) => {
      if (!active || terminal || !eventName.startsWith("submission.")) return;

      let payload: SubmissionEventPayload;
      try {
        payload = JSON.parse(rawData) as SubmissionEventPayload;
      } catch {
        return;
      }

      if (payload.submissionId !== submissionId) return;
      void fetchSubmission();
    };

    const handleOpen = () => {
      clearTimer(connectionTimer);
      clearTimer(reconnectTimer);
      connectionTimer = null;
      reconnectTimer = null;
      setIsPollingFallback(false);
    };

    const handleError = () => {
      if (!active || terminal) return;
      clearTimer(connectionTimer);
      connectionTimer = null;
      clearTimer(reconnectTimer);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (!active || terminal) return;
        const closed = source?.readyState === EventSource.CLOSED;
        if (closed || document.visibilityState === "hidden") {
          startPolling();
        } else if (source?.readyState === EventSource.CONNECTING) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            if (active && !terminal) startPolling();
          }, CONNECTION_TIMEOUT_MS);
        } else {
          startPolling();
        }
      }, CONNECTION_TIMEOUT_MS);
    };

    if (typeof window.EventSource !== "function") {
      startPolling();
    } else {
      source = new EventSource(getEventsUrl(), { withCredentials: true });
      source.addEventListener("open", handleOpen);
      source.addEventListener("error", handleError);
      ["created", "queued", "running", "completed"].forEach((status) => {
        source?.addEventListener(`submission.${status}`, (event) => {
          handlePayload(`submission.${status}`, (event as MessageEvent).data);
        });
      });
      source.addEventListener("message", (event) => {
        const message = event as MessageEvent<string>;
        let payload: SubmissionEventPayload;
        try {
          payload = JSON.parse(message.data) as SubmissionEventPayload;
        } catch {
          return;
        }
        handlePayload(payload.event ?? "", message.data);
      });
      connectionTimer = window.setTimeout(() => {
        connectionTimer = null;
        if (active && !terminal) startPolling();
      }, CONNECTION_TIMEOUT_MS);
    }

    return cleanup;
  }, [submissionId]);

  return { isPollingFallback: Boolean(submissionId) && isPollingFallback };
}
