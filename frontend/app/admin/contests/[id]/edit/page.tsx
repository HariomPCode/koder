"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminGate } from "@/features/admin/AdminGate";
import { ContestForm } from "@/features/admin/ContestForm";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi } from "@/lib/api/admin";
import type { Contest } from "@/types/api";
import { useAuth } from "@/hooks/useAuth";
export default function EditContestPage() { const { id } = useParams(); const contestId = Array.isArray(id) ? id[0] : id; const router = useRouter(); const [contest, setContest] = useState<Contest | null>(null); const [error, setError] = useState<string | null>(null); const { user, status } = useAuth(); useEffect(() => { if (status !== "authenticated" || user?.role !== "admin" || !contestId) return; void adminApi.getContest(contestId).then((data) => setContest(data.contest)).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load contest.")); }, [contestId, status, user?.role]); return <AdminGate><PageContainer><h1 className="text-3xl font-bold text-foreground">Edit contest</h1>{error ? <div className="mt-8"><ErrorState title="Unable to load contest" description={error} /></div> : !contest ? <Skeleton className="mt-8 h-96" /> : <div className="mt-8"><ContestForm contest={contest} onSaved={() => router.push(`/admin/contests/${contest._id}`)} /></div>}</PageContainer></AdminGate>; }
