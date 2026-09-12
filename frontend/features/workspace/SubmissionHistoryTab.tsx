"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/layout/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { getQuestionSubmissions } from "@/lib/api/submissions";
import { getVerdictPresentation } from "@/lib/constants/verdict";
import type { Submission } from "@/types/api";

export function SubmissionHistoryTab({ questionId }: { questionId: string }) {
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void getQuestionSubmissions(questionId)
      .then((data) => {
        if (!active) return;
        setSubmissions(data.submissions ?? []);
      })
      .catch((caughtError) => {
        console.error(caughtError);
        if (active) setError(true);
      });

    return () => {
      active = false;
    };
  }, [questionId]);

  const orderedSubmissions = useMemo(
    () =>
      [...(submissions ?? [])].sort((a, b) => {
        const first = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const second = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return second - first;
      }),
    [submissions],
  );

  if (error) {
    return (
      <ErrorState
        title="Unable to load submissions"
        description="Please try again later."
      />
    );
  }

  if (submissions === null) {
    return (
      <div className="space-y-3" aria-label="Loading submissions">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (orderedSubmissions.length === 0) {
    return (
      <EmptyState
        title="No submissions yet"
        description="Your submissions for this problem will appear here."
      />
    );
  }

  return (
    <div className="space-y-2">
      {orderedSubmissions.map((submission, index) => {
        const presentation = getVerdictPresentation(submission.verdict);
        return (
          <div
            key={submission._id ?? `${submission.createdAt ?? "submission"}-${index}`}
            className="rounded-lg border border-border bg-background p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={`rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${presentation.className}`}
              >
                {presentation.label}
              </span>
              <time
                className="text-xs text-muted-foreground"
                dateTime={submission.createdAt}
              >
                {submission.createdAt
                  ? new Date(submission.createdAt).toLocaleString()
                  : "Unknown time"}
              </time>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Language: {submission.language ?? "Unknown"}</span>
              <span>Runtime: {submission.maxRuntime ?? 0} ms</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
