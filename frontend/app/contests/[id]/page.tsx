"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { getContest, getMyContestStanding, registerForContest, unregisterFromContest } from "@/lib/api/contests";
import type { Contest, Standing } from "@/types/api";
import { Countdown } from "@/features/contests/Countdown";
import { MyStanding } from "@/features/contests/MyStanding";

export default function ContestDetailPage() {
  const { id } = useParams();
  const contestId = Array.isArray(id) ? id[0] : id;
  const { status } = useAuth();
  const [contest, setContest] = useState<Contest | null>(null);
  const [registered, setRegistered] = useState(false);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!contestId) return;
    try {
      const data = await getContest(contestId);
      setContest(data.contest);
      setRegistered(data.registered);
      if (data.contest.status === "RUNNING" && data.registered) {
        const mine = await getMyContestStanding(contestId);
        setStanding(mine.standing ?? (mine.rank ? { userId: "me", rank: mine.rank, score: mine.score ?? 0, penalty: mine.penalty ?? 0, solvedCount: 0 } : null));
      } else setStanding(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load contest."); }
  }, [contestId]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  if (error) return <PageContainer><ErrorState title="Unable to load contest" description={error} /></PageContainer>;
  if (!contest) return <PageContainer><Skeleton className="h-10 w-72" /><Skeleton className="mt-4 h-32" /></PageContainer>;
  const toggleRegistration = async () => {
    if (!contestId) return;
    setPending(true);
    try {
      const response = registered ? await unregisterFromContest(contestId) : await registerForContest(contestId);
      setRegistered(Boolean("registered" in response ? response.registered : !response.removed));
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update registration."); }
    finally { setPending(false); }
  };
  return <PageContainer>
    <div className="flex flex-wrap items-start justify-between gap-6">
      <div><div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold tracking-tight text-foreground">{contest.title}</h1><span className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">{contest.status}</span></div><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{contest.description || "Contest details and participation information."}</p></div>
      <Countdown contest={contest} onResync={() => void load()} />
    </div>
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="rounded-xl bg-card p-6 ring-1 ring-foreground/10"><h2 className="text-lg font-semibold text-foreground">Contest information</h2><dl className="mt-5 grid gap-4 sm:grid-cols-3"><div><dt className="text-xs text-muted-foreground">Problems</dt><dd className="mt-1 text-xl font-semibold">{contest.problems.length}</dd></div><div><dt className="text-xs text-muted-foreground">Starts</dt><dd className="mt-1 text-sm">{new Date(contest.startTime).toLocaleString()}</dd></div><div><dt className="text-xs text-muted-foreground">Ends</dt><dd className="mt-1 text-sm">{new Date(contest.endTime).toLocaleString()}</dd></div></dl></section>
      <div className="space-y-4">{status === "authenticated" ? <Button disabled={pending || !["REGISTRATION", "RUNNING"].includes(contest.status)} onClick={() => void toggleRegistration()} className="w-full">{pending ? "Updating..." : registered ? "Unregister" : "Register"}</Button> : <Link href="/signin" className="inline-flex w-full justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Sign in to register</Link>}{standing ? <MyStanding standing={standing} /> : null}</div>
    </div>
    <nav className="mt-8 flex flex-wrap gap-4 text-sm font-semibold underline underline-offset-4"><Link href={`/contests/${contest._id}/leaderboard`}>Leaderboard</Link><Link href={`/contests/${contest._id}/submissions`}>My submissions</Link>{registered ? <Link href={`/contests/${contest._id}/problems`}>Contest problems</Link> : null}</nav>
  </PageContainer>;
}
