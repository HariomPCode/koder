"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminGate } from "@/features/admin/AdminGate";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi } from "@/lib/api/admin";
import type { Contest } from "@/types/api";
import { useAuth } from "@/hooks/useAuth";

export default function AdminContestsPage() {
  const [contests, setContests] = useState<Contest[] | null>(null);
  const [error, setError] = useState(false);
  const { user, status } = useAuth();
  useEffect(() => { if (status !== "authenticated" || user?.role !== "admin") return; void adminApi.getContests().then((data) => setContests(data.contests)).catch(() => setError(true)); }, [status, user?.role]);
  return <AdminGate><PageContainer><div className="flex items-center justify-between gap-4"><h1 className="text-3xl font-bold text-foreground">Manage contests</h1><Link href="/admin/contests/new" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">New contest</Link></div>{error ? <div className="mt-8"><ErrorState title="Unable to load contests" description="Please try again later." /></div> : !contests ? <Skeleton className="mt-8 h-48" /> : contests.length === 0 ? <p className="mt-8 text-sm text-muted-foreground">No contests found.</p> : <div className="mt-8 space-y-3">{contests.map((contest) => <div key={contest._id} className="rounded-lg border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-3"><Link href={`/admin/contests/${contest._id}`} className="font-medium text-foreground underline-offset-4 hover:underline">{contest.title}</Link><span className="text-sm text-muted-foreground">{contest.status}</span></div><div className="mt-3 flex gap-3 text-sm"><Link href={`/admin/contests/${contest._id}/edit`} className="underline">Edit</Link><Link href={`/admin/contests/${contest._id}/operations`} className="underline">Operations</Link></div></div>)}</div>}</PageContainer></AdminGate>;
}
