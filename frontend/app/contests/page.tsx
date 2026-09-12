"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import { getContests } from "@/lib/api/contests";
import type { Contest, ContestStatus } from "@/types/api";
import { ContestCard } from "@/features/contests/ContestCard";

const filters: Array<"ALL" | ContestStatus> = ["ALL", "REGISTRATION", "RUNNING", "SCHEDULED", "ENDED", "FINALIZED"];
export default function ContestsPage() {
  const [contests, setContests] = useState<Contest[] | null>(null); const [filter, setFilter] = useState<"ALL" | ContestStatus>("ALL"); const [error, setError] = useState(false);
  useEffect(() => { void getContests().then((data) => setContests(data.contests)).catch(() => setError(true)); }, []);
  const visible = useMemo(() => contests?.filter((contest) => filter === "ALL" || contest.status === filter) ?? [], [contests, filter]);
  return <PageContainer><header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold tracking-tight text-foreground">Contests</h1><p className="mt-2 text-sm text-muted-foreground">Browse upcoming, running, and completed contests.</p></div><label className="text-sm text-muted-foreground">Status<Select value={filter} onChange={(event) => setFilter(event.target.value as "ALL" | ContestStatus)}>{filters.map((value) => <option key={value} value={value}>{value === "ALL" ? "All contests" : value}</option>)}</Select></label></header>{error ? <div className="mt-8"><ErrorState title="Unable to load contests" description="Please try again later." /></div> : !contests ? <div className="mt-8 grid gap-4 md:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div> : visible.length === 0 ? <div className="mt-8"><EmptyState title="No contests found" description="Try another status or check back later." /></div> : <div className="mt-8 grid gap-6 md:grid-cols-2">{visible.map((contest) => <ContestCard key={contest._id} contest={contest} />)}</div>}</PageContainer>;
}
