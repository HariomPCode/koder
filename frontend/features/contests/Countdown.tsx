"use client";

import { useEffect, useMemo, useState } from "react";

import type { Contest } from "@/types/api";

const RESYNC_INTERVAL_MS = 60_000;

function getCountdown(contest: Contest, now: number) {
  const start = new Date(contest.startTime).getTime();
  const end = new Date(contest.endTime).getTime();
  if (now < start) return { label: "Starts in", target: start };
  if (now < end) return { label: "Ends in", target: end };
  return { label: "Contest ended", target: now };
}

export function Countdown({
  contest,
  onResync,
}: {
  contest: Contest;
  onResync?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const resync = window.setInterval(() => onResync?.(), RESYNC_INTERVAL_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(resync);
    };
  }, [onResync]);

  const countdown = useMemo(() => getCountdown(contest, now), [contest, now]);
  const remaining = Math.max(0, countdown.target - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <div aria-live="polite" className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {countdown.label}
      </p>
      <p className="mt-1 font-mono text-xl font-semibold text-foreground">
        {countdown.label === "Contest ended"
          ? "—"
          : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`}
      </p>
    </div>
  );
}
