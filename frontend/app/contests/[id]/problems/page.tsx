"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { getContestProblems } from "@/lib/api/contests";
import type { ContestProblemItem } from "@/types/api";

export default function ContestProblemsPage() {
  const { id } = useParams();
  const contestId = Array.isArray(id) ? id[0] : id;
  const [problems, setProblems] = useState<ContestProblemItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (contestId) void getContestProblems(contestId).then((data) => setProblems(data.problems)).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load problems.")); }, [contestId]);
  if (error) return <PageContainer><ErrorState title="Unable to load contest problems" description={error} /></PageContainer>;
  if (!problems) return <PageContainer><Skeleton className="h-10 w-64" /><Skeleton className="mt-6 h-48" /></PageContainer>;
  return <PageContainer><h1 className="text-3xl font-bold text-foreground">Contest problems</h1><div className="mt-8 space-y-3">{problems.map((item) => item.question ? <Link key={item.questionId} href={`/contests/${contestId}/problems/${item.question.slug}`} className="block rounded-lg border border-border bg-card p-4 hover:border-primary"><div className="flex justify-between"><span className="font-medium">{item.order}. {item.question.title}</span><span className="text-sm text-muted-foreground">{item.points} points</span></div></Link> : null)}</div></PageContainer>;
}
