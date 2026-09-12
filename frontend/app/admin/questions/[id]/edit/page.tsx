"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminGate } from "@/features/admin/AdminGate";
import { QuestionForm } from "@/features/admin/QuestionForm";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi } from "@/lib/api/admin";
import type { AdminQuestion } from "@/types/api";
import { useAuth } from "@/hooks/useAuth";
export default function EditQuestionPage() { const { id } = useParams(); const questionId = Array.isArray(id) ? id[0] : id; const router = useRouter(); const [question, setQuestion] = useState<AdminQuestion | null>(null); const [error, setError] = useState<string | null>(null); const { user, status } = useAuth(); useEffect(() => { if (status !== "authenticated" || user?.role !== "admin" || !questionId) return; void adminApi.getQuestion(questionId).then((data) => setQuestion(data.question)).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load question.")); }, [questionId, status, user?.role]); return <AdminGate><PageContainer><h1 className="text-3xl font-bold text-foreground">Edit question</h1>{error ? <div className="mt-8"><ErrorState title="Unable to load question" description={error} /></div> : !question ? <Skeleton className="mt-8 h-96" /> : <div className="mt-8"><QuestionForm question={question} onSaved={() => router.push("/admin/questions")} /></div>}</PageContainer></AdminGate>; }
