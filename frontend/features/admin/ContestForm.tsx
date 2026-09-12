"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/layout/ErrorState";
import { adminApi } from "@/lib/api/admin";
import type { AdminQuestion, Contest, ContestProblemInput } from "@/types/api";
import { useAuth } from "@/hooks/useAuth";

function dateValue(value?: string) { return value ? new Date(value).toISOString().slice(0, 16) : ""; }

export function ContestForm({ contest, onSaved }: { contest?: Contest; onSaved: (id: string) => void }) {
  const [title, setTitle] = useState(contest?.title ?? "");
  const [slug, setSlug] = useState(contest?.slug ?? "");
  const [description, setDescription] = useState(contest?.description ?? "");
  const [registrationOpenTime, setRegistrationOpenTime] = useState(dateValue(contest?.registrationOpenTime));
  const [startTime, setStartTime] = useState(dateValue(contest?.startTime));
  const [endTime, setEndTime] = useState(dateValue(contest?.endTime));
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [problems, setProblems] = useState<ContestProblemInput[]>(contest?.problems ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { user, status } = useAuth();
  useEffect(() => { if (status !== "authenticated" || user?.role !== "admin") return; void Promise.resolve().then(() => adminApi.getQuestions()).then((data) => setQuestions(data.questions)).catch(() => setQuestions([])); }, [status, user?.role]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setPending(true); setError(null);
    const payload = { title, slug, description, registrationOpenTime: new Date(registrationOpenTime).toISOString(), startTime: new Date(startTime).toISOString(), endTime: new Date(endTime).toISOString(), problems };
    try { const response = contest ? await adminApi.updateContest(contest._id, payload) : await adminApi.createContest(payload); onSaved(response.contest._id); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save contest."); }
    finally { setPending(false); }
  };
  return <form onSubmit={submit} className="space-y-6">{error ? <ErrorState title="Unable to save contest" description={error} /> : null}<div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Title<input required value={title} onChange={(event) => { const value = event.target.value; setTitle(value); if (!contest && !slug) setSlug(value.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-")); }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label><label className="text-sm">Slug<input required value={slug} onChange={(event) => setSlug(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label><label className="text-sm sm:col-span-2">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label><DateField label="Registration opens" value={registrationOpenTime} onChange={setRegistrationOpenTime} /><DateField label="Starts" value={startTime} onChange={setStartTime} /><DateField label="Ends" value={endTime} onChange={setEndTime} /></div><div className="space-y-3"><h2 className="font-semibold text-foreground">Problem set</h2>{problems.map((problem, index) => <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_8rem_auto]" key={index}><select aria-label={`Problem ${index + 1}`} value={problem.questionId} onChange={(event) => setProblems(problems.map((item, itemIndex) => itemIndex === index ? { ...item, questionId: event.target.value } : item))} className="rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="">Select question</option>{questions.map((question) => <option key={question._id} value={question._id}>{question.title}</option>)}</select><input aria-label={`Order ${index + 1}`} type="number" min="1" value={problem.order} onChange={(event) => setProblems(problems.map((item, itemIndex) => itemIndex === index ? { ...item, order: Number(event.target.value) } : item))} className="rounded-md border border-input bg-background px-2 py-2" /><input aria-label={`Points ${index + 1}`} type="number" min="0" value={problem.points} onChange={(event) => setProblems(problems.map((item, itemIndex) => itemIndex === index ? { ...item, points: Number(event.target.value) } : item))} className="rounded-md border border-input bg-background px-2 py-2" /><input aria-label={`Penalty ${index + 1}`} type="number" min="0" value={problem.penaltyMinutes} onChange={(event) => setProblems(problems.map((item, itemIndex) => itemIndex === index ? { ...item, penaltyMinutes: Number(event.target.value) } : item))} className="rounded-md border border-input bg-background px-2 py-2" /><Button type="button" variant="ghost" onClick={() => setProblems(problems.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button></div>)}<Button type="button" variant="outline" onClick={() => setProblems([...problems, { questionId: "", order: problems.length + 1, points: 100, penaltyMinutes: 20 }])}>Add problem</Button></div><Button disabled={pending} type="submit">{pending ? "Saving..." : contest ? "Update contest" : "Create contest"}</Button></form>;
}
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="text-sm">{label}<input required type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label>; }
