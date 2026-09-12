"use client";

import Editor from "@monaco-editor/react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { getEditorCode, writePersistedEditorCode } from "@/lib/editor-storage";
import type {
  ProblemDetail,
  StarterCode,
  Submission,
  SubmissionCreateResponse,
} from "@/types/api";
import { EditorToolbar } from "@/features/workspace/EditorToolbar";
import { ResizeHandle } from "@/features/workspace/ResizeHandle";
import { ResultDrawer } from "@/features/workspace/ResultDrawer";
import { StatementPane } from "@/features/workspace/StatementPane";
import { useResizablePanes } from "@/features/workspace/useResizablePanes";
import { getSubmissionErrorMessage } from "@/lib/api/submissions";
import { useSubmissionEvents } from "@/hooks/useSubmissionEvents";

export default function SolveProblem() {
  const { slug } = useParams();
  const problemSlug = Array.isArray(slug) ? slug[0] : slug;
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [activeSubmissionId, setActiveSubmissionId] = useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionUpdateError, setSubmissionUpdateError] = useState<
    string | null
  >(null);
  const [code, setCode] = useState("function solve() {\n\n}");
  const [language, setLanguage] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);
  const {
    leftPanelWidth,
    isResizing,
    handlePointerDown,
    adjustLeftPanelWidth,
  } = useResizablePanes();

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      adjustLeftPanelWidth(-4);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      adjustLeftPanelWidth(4);
    }
  };

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
          : (starter?.code ?? ""),
      );
    } catch (err) {
      console.error(err);
      toast.add({ type: "error", description: "Failed to fetch question" });
    }
  };

  useEffect(() => {
    // Load the selected problem when the dynamic route parameter is available.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (slug) void fetchQuestion();
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

  useSubmissionEvents({
    submissionId: activeSubmissionId,
    onSubmissionUpdate: (nextSubmission) => {
      setSubmission(nextSubmission);
      setSubmissionUpdateError(null);
    },
    onTerminal: (completedSubmission) => {
      setIsSubmitting(false);
      toast.add({
        type: "success",
        description: completedSubmission.verdict,
      });
    },
    onPollingError: setSubmissionUpdateError,
  });

  const submitProblem = async () => {
    if (!problem || isSubmitting) return;
    setIsSubmitting(true);
    setSubmissionUpdateError(null);
    try {
      const data = await api.post<SubmissionCreateResponse>(
        `/api/v1/submissions/${problem._id}`,
        { language, code },
      );
      setSubmission({
        status: "created",
        verdict: "",
        language,
      });
      setActiveSubmissionId(data.submissionId);
      toast.add({ type: "success", description: "Submission queued" });
    } catch (err) {
      console.error(err);
      toast.add({
        type: "error",
        description: getSubmissionErrorMessage(err),
      });
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background md:h-[calc(100dvh-4rem)]">
      <a
        href="#editor-workspace"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-background focus:px-4 focus:py-2 focus:text-foreground"
      >
        Skip to editor
      </a>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div style={isDesktop ? { width: `${leftPanelWidth}%` } : undefined}>
          <StatementPane problem={problem} />
        </div>
        <ResizeHandle
          leftPanelWidth={leftPanelWidth}
          isResizing={isResizing}
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handlePointerDown}
        />
        <section
          id="editor-workspace"
          tabIndex={-1}
          className="flex min-h-168 min-w-0 flex-1 flex-col bg-zinc-950 outline-none md:min-h-0"
        >
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
          <ResultDrawer
            submission={submission}
            submissionUpdateError={submissionUpdateError}
          />
        </section>
      </div>
    </main>
  );
}
