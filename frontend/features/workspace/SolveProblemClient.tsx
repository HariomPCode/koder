"use client";

import Editor from "@monaco-editor/react";
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

export default function SolveProblemClient({
  problem,
  slug,
}: {
  problem: ProblemDetail;
  slug: string;
}) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [activeSubmissionId, setActiveSubmissionId] = useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionUpdateError, setSubmissionUpdateError] = useState<
    string | null
  >(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [isDesktop, setIsDesktop] = useState(false);
  const {
    leftPanelWidth,
    isResizing,
    handlePointerDown,
    adjustLeftPanelWidth,
  } = useResizablePanes();
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const starter = problem.starterCode.find(
      (item: StarterCode) => item.language === "javascript",
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCode(getEditorCode(slug, "javascript", starter?.code ?? ""));
  }, [problem, slug]);
  const handleLanguageChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const nextLanguage = event.target.value;
    writePersistedEditorCode(slug, language, code);
    setLanguage(nextLanguage);
    const starter =
      problem.starterCode.find((item) => item.language === nextLanguage)
        ?.code ?? "";
    setCode(getEditorCode(slug, nextLanguage, starter));
    setSubmission(null);
  };
  const handleCodeChange = (value: string | undefined) => {
    const next = value ?? "";
    setCode(next);
    writePersistedEditorCode(slug, language, next);
  };
  useSubmissionEvents({
    submissionId: activeSubmissionId,
    onSubmissionUpdate: (next) => {
      setSubmission(next);
      setSubmissionUpdateError(null);
    },
    onTerminal: (completed) => {
      setIsSubmitting(false);
      toast.add({ type: "success", description: completed.verdict });
    },
    onPollingError: setSubmissionUpdateError,
  });
  const submitProblem = async () => {
    if (isSubmitting) return;
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
        _id: data.submissionId,
      });
      setActiveSubmissionId(data.submissionId);
      toast.add({ type: "success", description: "Submission queued" });
    } catch (error) {
      toast.add({
        type: "error",
        description: getSubmissionErrorMessage(error),
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
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              adjustLeftPanelWidth(-4);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              adjustLeftPanelWidth(4);
            }
          }}
          onPointerDown={handlePointerDown}
        />
        <section
          id="editor-workspace"
          tabIndex={-1}
          className="flex min-h-[calc(100dvh-4rem)] min-w-0 flex-1 flex-col bg-zinc-950 outline-none md:min-h-0"
        >
          <EditorToolbar
            language={language}
            problem={problem}
            submission={submission}
            isSubmitting={isSubmitting}
            onLanguageChange={handleLanguageChange}
            onSubmit={() => void submitProblem()}
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
                minimap: { enabled: false },
                automaticLayout: true,
                scrollBeyondLastLine: false,
                wordWrap: "on",
                padding: { top: 18, bottom: 18 },
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
