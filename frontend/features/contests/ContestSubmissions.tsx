"use client";

import { useEffect, useState } from "react";

import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/layout/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { getContestSubmissions } from "@/lib/api/contests";
import { getVerdictPresentation } from "@/lib/constants/verdict";
import type { Pagination, Submission } from "@/types/api";

export function ContestSubmissions({ contestId }: { contestId: string }) {
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getContestSubmissions(contestId, page)
      .then((data) => {
        if (!active) return;
        setSubmissions(data.submissions ?? []);
        setPagination(data.pagination);
      })
      .catch(() => {
        if (active) setError("Unable to load contest submissions.");
      });
    return () => { active = false; };
  }, [contestId, page]);

  if (error) return <ErrorState title="Unable to load submissions" description={error} />;
  if (!submissions) return <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>;
  if (!submissions.length) return <EmptyState title="No contest submissions yet" description="Your contest attempts will appear here." />;

  return (
    <div className="space-y-3">
      {submissions.map((submission, index) => {
        const presentation = getVerdictPresentation(submission.verdict);
        return <div key={submission._id ?? index} className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={`rounded-full px-2 py-1 text-xs ring-1 ring-inset ${presentation.className}`}>{presentation.label}</span>
            <time className="text-xs text-muted-foreground">{submission.createdAt ? new Date(submission.createdAt).toLocaleString() : "Unknown time"}</time>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{submission.language ?? "Unknown"} · {submission.maxRuntime ?? 0} ms</p>
        </div>;
      })}
      {pagination && pagination.totalPages > 1 ? <div className="flex items-center justify-between text-sm"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="underline disabled:opacity-50">Previous</button><span className="text-muted-foreground">Page {page} of {pagination.totalPages}</span><button disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)} className="underline disabled:opacity-50">Next</button></div> : null}
    </div>
  );
}
