"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminGate } from "@/features/admin/AdminGate";
import { ErrorState } from "@/components/layout/ErrorState";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { adminApi } from "@/lib/api/admin";
import type { AdminQuestion } from "@/types/api";
import { useAuth } from "@/hooks/useAuth";

export default function AdminQuestionsPage() {
  const [questions, setQuestions] = useState<AdminQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminQuestion | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { user, status } = useAuth();
  const load = () => {
    setError(null);
    void adminApi.getQuestions().then((data) => setQuestions(data.questions)).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load questions."));
  };
  useEffect(() => { if (status === "authenticated" && user?.role === "admin") void Promise.resolve().then(load); }, [status, user?.role]);
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await adminApi.deleteQuestion(deleting._id);
      setQuestions((current) => current?.filter((question) => question._id !== deleting._id) ?? []);
      setDeleting(null);
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "Unable to delete question.");
    }
  };
  return <AdminGate><PageContainer>
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-bold text-foreground">Manage questions</h1><p className="mt-2 text-sm text-muted-foreground">Create, edit, and remove problem definitions.</p></div><Link href="/admin/questions/new" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">New question</Link></div>
    <div className="mt-8">{error ? <ErrorState title="Unable to load questions" description={error} action={{ label: "Try again", onClick: load }} /> : !questions ? <Skeleton className="h-56" /> : questions.length === 0 ? <EmptyState title="No questions found" description="Create the first question to populate the catalog." /> : <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[42rem] text-left text-sm"><thead className="bg-muted text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Title</th><th className="px-4 py-3">Difficulty</th><th className="px-4 py-3">Slug</th><th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y divide-border bg-card">{questions.map((question) => <tr key={question._id}><td className="px-4 py-3 font-medium text-foreground">{question.title}</td><td className="px-4 py-3">{question.difficulty}</td><td className="px-4 py-3 text-muted-foreground">{question.slug}</td><td className="px-4 py-3"><div className="flex gap-3"><Link className="underline underline-offset-4" href={`/admin/questions/${question._id}/edit`}>Edit</Link><Button variant="destructive" size="sm" onClick={() => { setDeleteError(null); setDeleting(question); }}>Delete</Button></div></td></tr>)}</tbody></table></div>}</div>
    <Dialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null); }}><DialogContent><h2 className="text-lg font-semibold text-foreground">Delete question?</h2><p className="mt-2 text-sm text-muted-foreground">This permanently removes {deleting?.title ?? "this question"}.</p>{deleteError ? <p className="mt-3 text-sm text-destructive">{deleteError}</p> : null}<div className="mt-6 flex justify-end gap-3"><Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" onClick={() => void confirmDelete()}>Confirm delete</Button></div></DialogContent></Dialog>
  </PageContainer></AdminGate>;
}
