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

export default function AdminPage() {
  const [contests, setContests] = useState<Contest[] | null>(null);
  const [error, setError] = useState(false);
  const { user, status } = useAuth();
  useEffect(() => { if (status !== "authenticated" || user?.role !== "admin") return; void adminApi.getContests().then((data) => setContests(data.contests)).catch(() => setError(true)); }, [status, user?.role]);
  return <AdminGate><PageContainer><header><h1 className="text-3xl font-bold text-foreground">Admin</h1><p className="mt-2 text-sm text-muted-foreground">Manage contests, questions, and users.</p></header><nav className="mt-6 flex flex-wrap gap-4 text-sm font-semibold underline underline-offset-4"><Link href="/admin/contests">Contests</Link><Link href="/admin/questions">Questions</Link><Link href="/admin/users">Users</Link></nav>{error ? <div className="mt-8"><ErrorState title="Unable to load admin data" description="Please try again later." /></div> : !contests ? <Skeleton className="mt-8 h-48" /> : <div className="mt-8 rounded-lg border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Managed contests</p><p className="mt-2 text-3xl font-semibold text-foreground">{contests.length}</p></div>}</PageContainer></AdminGate>;
}
