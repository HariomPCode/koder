"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { ErrorState } from "@/components/layout/ErrorState";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { getContestStandings, getMyContestStanding, getContest } from "@/lib/api/contests";
import type { Contest, Pagination, Standing } from "@/types/api";
import { LeaderboardTable } from "@/features/contests/LeaderboardTable";
import { MyStanding } from "@/features/contests/MyStanding";
import { useAuth } from "@/hooks/useAuth";
import { useContestLeaderboardEvents } from "@/hooks/useContestLeaderboardEvents";

export default function ContestLeaderboardPage() {
  const { id } = useParams();
  const contestId = Array.isArray(id) ? id[0] : id;
  const { status } = useAuth();
  const [standings, setStandings] = useState<Standing[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [contest, setContest] = useState<Contest | null>(null);
  const [mine, setMine] = useState<Standing | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    if (!contestId) return;
    try {
      const [data, details] = await Promise.all([getContestStandings(contestId, page), getContest(contestId)]);
      setStandings(data.standings); setPagination(data.pagination); setContest(details.contest);
      if (status === "authenticated" && details.registered && details.contest.status === "RUNNING") {
        const response = await getMyContestStanding(contestId);
        setMine(response.standing ?? null);
      } else setMine(null);
    } catch { setError(true); }
  }, [contestId, page, status]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useContestLeaderboardEvents(contestId ?? "", () => void load(), contest?.status === "RUNNING");
  if (error) return <PageContainer><ErrorState title="Unable to load leaderboard" description="Please try again later." /></PageContainer>;
  if (!standings) return <PageContainer><Skeleton className="h-9 w-64" /><Skeleton className="mt-8 h-72" /></PageContainer>;
  return <PageContainer><header><h1 className="text-3xl font-bold text-foreground">Leaderboard</h1><p className="mt-2 text-sm text-muted-foreground">Live standings for this contest.</p></header>{mine ? <div className="mt-6 max-w-sm"><MyStanding standing={mine} /></div> : null}<div className="mt-6"><LeaderboardTable standings={standings} /></div>{pagination && pagination.totalPages > 1 ? <div className="mt-5 flex justify-between text-sm"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="underline disabled:opacity-50">Previous</button><span className="text-muted-foreground">Page {page} of {pagination.totalPages}</span><button disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)} className="underline disabled:opacity-50">Next</button></div> : null}</PageContainer>;
}
