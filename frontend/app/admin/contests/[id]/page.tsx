"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminGate } from "@/features/admin/AdminGate";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi } from "@/lib/api/admin";
import { useAuth } from "@/hooks/useAuth";
import type { Contest } from "@/types/api";
import { getContestLifecycleActions } from "@/features/admin/lifecycle";
const labels = { startContest: "Start contest", endContest: "End contest", finalizeContest: "Finalize contest" };

export default function AdminContestPage() {
  const { id } = useParams(); const contestId = Array.isArray(id) ? id[0] : id; const { user, status } = useAuth();
  const [contest, setContest] = useState<Contest | null>(null); const [error, setError] = useState<string | null>(null); const [pending, setPending] = useState(false);
  const reload = useCallback(() => { if (status !== "authenticated" || user?.role !== "admin" || !contestId) return; void adminApi.getContest(contestId).then((data) => setContest(data.contest)).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load contest.")); }, [contestId, status, user?.role]);
  useEffect(() => { reload(); }, [reload]);
  const transition = async (action: "startContest" | "endContest" | "finalizeContest") => { if (!contestId || !window.confirm(`Confirm ${labels[action].toLowerCase()}?`)) return; setPending(true); setError(null); try { await adminApi[action](contestId); reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update contest."); reload(); } finally { setPending(false); } };
  return <AdminGate><PageContainer>{error ? <div className="mb-6"><ErrorState title="Contest request failed" description={error} /></div> : null}{!contest ? <Skeleton className="h-56" /> : <><div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-bold text-foreground">{contest.title}</h1><p className="mt-2 text-sm text-muted-foreground">{contest.status}</p></div><div className="flex gap-3 text-sm"><Link href={`/admin/contests/${contest._id}/edit`} className="underline">Edit</Link><Link href={`/admin/contests/${contest._id}/operations`} className="underline">Operations</Link></div></div><div className="mt-8 flex flex-wrap gap-3">{getContestLifecycleActions(contest.status).map((action) => <Button key={action} disabled={pending} onClick={() => void transition(action)}>{pending ? "Updating..." : labels[action]}</Button>)}</div></>}</PageContainer></AdminGate>;
}
