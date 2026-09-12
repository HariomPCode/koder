"use client";

import Editor from "@monaco-editor/react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import {
  getEditorCode,
  writePersistedEditorCode,
} from "@/lib/editor-storage";
import type {
  ProblemDetail,
  StarterCode,
  Submission,
  SubmissionCreateResponse,
  SubmissionResponse,
} from "@/types/api";
import { EditorToolbar } from "@/features/workspace/EditorToolbar";
import { ResizeHandle } from "@/features/workspace/ResizeHandle";
import { ResultDrawer } from "@/features/workspace/ResultDrawer";
import { StatementPane } from "@/features/workspace/StatementPane";
import { useResizablePanes } from "@/features/workspace/useResizablePanes";

export default function SolveProblem() {
  const { slug } = useParams();
  const problemSlug = Array.isArray(slug) ? slug[0] : slug;
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [activeSubmissionId, setActiveSubmissionId] = useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [code, setCode] = useState("function solve() {\n\n}");
  const [language, setLanguage] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);
  const { leftPanelWidth, isResizing, handlePointerDown } =
    useResizablePanes();

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const fetchQuestion = async () => {
    try {
      const data = await api.get<{ question: ProblemDetail }>(
        `/api/v1/questions/${slug}`,
      );
      setProblem(data.question);
      const starter = data.question.starterCode.find(
        (item: StarterCode) => item.language === "javascript",
      );
      setLanguage("javascript");
      setCode(
        problemSlug
          ? getEditorCode(problemSlug, "javascript", starter?.code ?? "")
          : starter?.code ?? "",
      );
    } catch (err) {
      console.error(err);
      toast.add({ type: "error", description: "Failed to fetch question" });
    }
  };

  useEffect(() => {
    // Load the selected problem when the dynamic route parameter is available.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (problemSlug) void fetchQuestion();
    // The loader is stable for this page and only the route parameter controls this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemSlug]);

  const handleLanguageChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const newLanguage = event.target.value;
    if (problemSlug && language) {
      writePersistedEditorCode(problemSlug, language, code);
    }
    setLanguage(newLanguage);
    const starterCode =
      problem?.starterCode.find((item) => item.language === newLanguage)
        ?.code ?? "";
    setCode(
      problemSlug
        ? getEditorCode(problemSlug, newLanguage, starterCode)
        : starterCode,
    );
    setSubmission(null);
  };

  const handleCodeChange = (value: string | undefined) => {
    const nextCode = value ?? "";
    setCode(nextCode);
    if (problemSlug && language) {
      writePersistedEditorCode(problemSlug, language, nextCode);
    }
  };

  const pollSubmission = (submissionId: string) => {
    const interval = window.setInterval(async () => {
      try {
        const data = await api.get<SubmissionResponse>(
          `/api/v1/submissions/${submissionId}`,
        );
        setSubmission(data.submission);
        if (data.submission.status === "completed") {
          window.clearInterval(interval);
          setIsSubmitting(false);
          toast.add({ type: "success", description: data.submission.verdict });
        }
      } catch (err) {
        window.clearInterval(interval);
        setIsSubmitting(false);
        console.error(err);
        toast.add({
          type: "error",
          description: "Failed to fetch submission",
        });
      }
    }, 1000);
  };

  useEffect(() => {
    if (!activeSubmissionId) return undefined;
    const events = new EventSource(
      `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/v1/events/stream`,
      {
        withCredentials: true,
      },
    );
    const handleCompleted = async (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { submissionId?: string };
        if (payload.submissionId !== activeSubmissionId) return;
        const data = await api.get<SubmissionResponse>(
          `/api/v1/submissions/${activeSubmissionId}`,
        );
        setSubmission(data.submission);
        setIsSubmitting(false);
      } catch (error) {
        console.error(error);
      }
    };
    events.addEventListener("submission.completed", handleCompleted);
    return () => events.close();
  }, [activeSubmissionId]);

  const submitProblem = async () => {
    if (!problem || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const data = await api.post<SubmissionCreateResponse>(
        `/api/v1/submissions/${problem._id}`,
        { language, code },
      );
      setActiveSubmissionId(data.submissionId);
      toast.add({ type: "success", description: "Submission queued" });
      pollSubmission(data.submissionId);
    } catch (err) {
      console.error(err);
      toast.add({ type: "error", description: "Failed to submit solution" });
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background md:h-[calc(100dvh-4rem)]">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div style={isDesktop ? { width: `${leftPanelWidth}%` } : undefined}>
          <StatementPane problem={problem} />
        </div>
        <ResizeHandle
          isResizing={isResizing}
          onPointerDown={handlePointerDown}
        />
        <section className="flex min-h-168 min-w-0 flex-1 flex-col bg-zinc-950 md:min-h-0">
          <EditorToolbar
            language={language}
            problem={problem}
            submission={submission}
            isSubmitting={isSubmitting}
            onLanguageChange={handleLanguageChange}
            onSubmit={submitProblem}
          />
          <div className="min-h-0 flex-1">
            <Editor
              height="100%"
              language={language}
              theme="vs-dark"
              value={code}
              onChange={handleCodeChange}
              options={{
                fontSize: 14,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                lineHeight: 22,
                lineNumbersMinChars: 3,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "on",
                padding: { top: 18, bottom: 18 },
                cursorSmoothCaretAnimation: "on",
              }}
            />
          </div>
          <ResultDrawer submission={submission} />
        </section>
      </div>
    </main>
  );
}
