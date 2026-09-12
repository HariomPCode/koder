"use client";

import Editor from "@monaco-editor/react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "@/components/layout/ErrorState";
import { EditorToolbar } from "@/features/workspace/EditorToolbar";
import { ResizeHandle } from "@/features/workspace/ResizeHandle";
import { ResultDrawer } from "@/features/workspace/ResultDrawer";
import { StatementPane } from "@/features/workspace/StatementPane";
import { useResizablePanes } from "@/features/workspace/useResizablePanes";
import { getContestProblems, createContestSubmission, getContestSubmissionErrorMessage } from "@/lib/api/contests";
import { getEditorCode, writePersistedEditorCode } from "@/lib/editor-storage";
import { useSubmissionEvents } from "@/hooks/useSubmissionEvents";
import type { ContestProblemItem, ProblemDetail, Submission } from "@/types/api";

export default function ContestProblemWorkspace() {
  const params = useParams();
  const contestId = Array.isArray(params.id) ? params.id[0] : params.id;
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const [item, setItem] = useState<ContestProblemItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [activeSubmissionId, setActiveSubmissionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { leftPanelWidth, isResizing, handlePointerDown, adjustLeftPanelWidth } = useResizablePanes();
  const problem: ProblemDetail | null = item?.question ?? null;
  const onSubmissionUpdate = useCallback((next: Submission) => { setSubmission(next); setSubmitting(next.status !== "completed"); }, []);
  useSubmissionEvents({ submissionId: activeSubmissionId, onSubmissionUpdate, onPollingError: setSubmissionError });

  useEffect(() => {
    if (!contestId) return;
    void getContestProblems(contestId).then((data) => {
      const match = data.problems.find((candidate) => candidate.question?.slug === slug);
      if (!match) { setError("Contest problem not found."); return; }
      setItem(match);
      const starter = match.question?.starterCode?.find((value) => value.language === language)?.code ?? "";
      setCode(getEditorCode(slug ?? "", language, starter));
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load contest problem."));
  }, [contestId, slug, language]);

  const changeLanguage = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextLanguage = event.target.value;
    if (slug) writePersistedEditorCode(slug, language, code);
    setLanguage(nextLanguage);
  };
  const changeCode = (value: string | undefined) => { const next = value ?? ""; setCode(next); if (slug) writePersistedEditorCode(slug, language, next); };
  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => { if (event.key === "ArrowLeft") { event.preventDefault(); adjustLeftPanelWidth(-4); } if (event.key === "ArrowRight") { event.preventDefault(); adjustLeftPanelWidth(4); } };
  const submit = async () => {
    if (!contestId || !item || submitting) return;
    setSubmitting(true); setSubmissionError(null); setError(null);
    try {
      const result = await createContestSubmission(contestId, { contestProblemId: item.questionId, language, code });
      setSubmission({ _id: result.submissionId, status: "created", verdict: "", language });
      setActiveSubmissionId(result.submissionId);
    } catch (caught) { setSubmissionError(getContestSubmissionErrorMessage(caught)); setSubmitting(false); }
  };
  if (error) return <div className="p-8"><ErrorState title="Unable to load problem" description={error} /></div>;
  return <main className="flex min-h-[calc(100dvh-4rem)] flex-col bg-background md:flex-row">{problem ? <div className="min-h-0 md:flex-1" style={{ width: `${leftPanelWidth}%` }}><StatementPane problem={problem} /></div> : <div className="min-h-0 md:flex-1"><StatementPane problem={null} /></div>}<ResizeHandle leftPanelWidth={leftPanelWidth} isResizing={isResizing} onKeyDown={handleResizeKeyDown} onPointerDown={handlePointerDown} /><section className="flex min-h-[32rem] min-w-0 flex-1 flex-col bg-zinc-950"><EditorToolbar language={language} problem={problem} submission={submission} isSubmitting={submitting} onLanguageChange={changeLanguage} onSubmit={() => void submit()} /><div className="min-h-0 flex-1"><Editor height="100%" language={language} theme="vs-dark" value={code} onChange={changeCode} options={{ minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false }} /></div><ResultDrawer submission={submission} submissionUpdateError={submissionError} /></section></main>;
}
