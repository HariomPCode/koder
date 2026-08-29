"use client";

import Editor from "@monaco-editor/react";
import { Button } from "@base-ui/react";
import { toast } from "@/components/ui/toast";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface Testcase { input: string; output: string; }
interface StarterCode { language: string; code: string; }
interface Problem {
  _id: string; questionNum: number; title: string; slug: string;
  difficulty: "Easy" | "Medium" | "Hard"; description: string;
  constraints: string[]; sampleTestCases: Testcase[]; tags: string[]; starterCode: StarterCode[];
}
interface FailedTestCase { input?: string; expected?: string; received?: string; }
interface Submission {
  status: string; verdict: string; passedTestCases: number; totalTestCases: number;
  maxRuntime: number; memory: number; failedTestCase?: FailedTestCase | null; errorMessage?: string | null;
}

const verdictStyles: Record<string, string> = {
  Accepted: "text-emerald-700", "Wrong Answer": "text-amber-700", "Runtime Error": "text-rose-700",
  "Compilation Error": "text-rose-700", "Time Limit Exceeded": "text-orange-700",
};
const difficultyStyles: Record<Problem["difficulty"], string> = {
  Easy: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  Medium: "bg-amber-50 text-amber-700 ring-amber-600/15",
  Hard: "bg-rose-50 text-rose-700 ring-rose-600/15",
};

function CodeValue({ children }: { children?: string }) {
  return <pre className="mt-1.5 overflow-x-auto rounded-md bg-slate-100 px-3 py-2 font-mono text-xs leading-5 text-slate-700 whitespace-pre-wrap">{children || "—"}</pre>;
}

export default function SolveProblem() {
  const { slug } = useParams();
  const backendUri = process.env.NEXT_PUBLIC_BACKEND_URL;
  const [problem, setProblem] = useState<Problem | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [code, setCode] = useState("function solve() {\n\n}");
  const [language, setLanguage] = useState("");
  const [leftPanelWidth, setLeftPanelWidth] = useState(46);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const resize = (event: PointerEvent) => setLeftPanelWidth(Math.min(64, Math.max(34, (event.clientX / window.innerWidth) * 100)));
    const stop = () => setIsResizing(false);
    window.addEventListener("pointermove", resize); window.addEventListener("pointerup", stop);
    return () => { window.removeEventListener("pointermove", resize); window.removeEventListener("pointerup", stop); };
  }, [isResizing]);

  useEffect(() => { if (slug) void fetchQuestion(); }, [slug]);

  const fetchQuestion = async () => {
    try {
      const res = await fetch(`${backendUri}/api/v1/questions/${slug}`);
      if (!res.ok) throw new Error("Failed to fetch question");
      const data = await res.json();
      setProblem(data.question);
      const starter = data.question.starterCode.find((item: StarterCode) => item.language === "javascript");
      setLanguage("javascript"); setCode(starter?.code ?? "");
    } catch (err) {
      console.error(err); toast.add({ type: "failure", description: "Failed to fetch question" });
    }
  };

  const handleLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = event.target.value;
    setLanguage(newLanguage);
    setCode(problem?.starterCode.find((item) => item.language === newLanguage)?.code ?? "");
    setSubmission(null);
  };

  const pollSubmission = (submissionId: string) => {
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(`${backendUri}/api/v1/submissions/${submissionId}`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to fetch submission");
        const data = await res.json(); setSubmission(data.submission);
        if (data.submission.status === "completed" || data.submission.status === "failed") {
          window.clearInterval(interval); setIsSubmitting(false);
          toast.add({ type: "success", description: data.submission.verdict });
        }
      } catch (err) {
        window.clearInterval(interval); setIsSubmitting(false); console.error(err);
        toast.add({ type: "failure", description: "Failed to fetch submission" });
      }
    }, 1000);
  };

  const submitProblem = async () => {
    if (!problem || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`${backendUri}/api/v1/submissions/${problem._id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ language, code }),
      });
      if (!res.ok) throw new Error("Submission failed");
      const data = await res.json();
      toast.add({ type: "success", description: "Submission queued" }); pollSubmission(data.submissionId);
    } catch (err) {
      console.error(err); toast.add({ type: "failure", description: "Failed to submit solution" }); setIsSubmitting(false);
    }
  };

  const failedTest = submission?.failedTestCase;
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-slate-100 md:h-[calc(100dvh-4rem)]">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section className="min-h-0 shrink-0 overflow-y-auto border-b border-slate-200 bg-white md:border-b-0 md:border-r" style={isDesktop ? { width: `${leftPanelWidth}%` } : undefined}>
          <div className="mx-auto max-w-3xl px-5 py-7 sm:px-7">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{problem ? `${problem.questionNum}. ${problem.title}` : "Loading problem…"}</h1>
              {problem && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${difficultyStyles[problem.difficulty]}`}>{problem.difficulty}</span>}
            </div>
            {problem && <section className="mt-8"><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Description</h2><p className="mt-3 whitespace-pre-wrap leading-7 text-slate-700">{problem.description}</p></section>}
            {problem && <section className="mt-9"><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Examples</h2><div className="mt-4 space-y-5">{problem.sampleTestCases.map((testcase, index) => <div key={index}><h3 className="text-sm font-semibold text-slate-800">Example {index + 1}</h3><div className="mt-2 grid gap-3"><div><p className="text-xs font-medium text-slate-500">Input</p><CodeValue>{testcase.input}</CodeValue></div><div><p className="text-xs font-medium text-slate-500">Output</p><CodeValue>{testcase.output}</CodeValue></div></div></div>)}</div></section>}
            {problem && <section className="mt-9"><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Constraints</h2><ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">{problem.constraints.map((constraint, index) => <li key={index} className="flex gap-2"><span className="text-slate-400">•</span><span>{constraint}</span></li>)}</ul></section>}
            {problem && <section className="mt-9"><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Topics</h2><div className="mt-3 flex flex-wrap gap-2">{problem.tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{tag}</span>)}</div></section>}
          </div>
        </section>
        <div aria-label="Resize problem and editor panels" className={`hidden w-1 shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-emerald-400 md:block ${isResizing ? "bg-emerald-500" : ""}`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setIsResizing(true); }} />
        <section className="flex min-h-[42rem] min-w-0 flex-1 flex-col bg-slate-950 md:min-h-0">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 sm:px-5">
            <select aria-label="Language" value={language} onChange={handleLanguageChange} className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 outline-none focus:border-emerald-500"><option value="javascript">JavaScript</option><option value="java">Java</option><option value="python">Python</option></select>
            <Button onClick={submitProblem} disabled={isSubmitting || !problem} className="inline-flex min-w-24 items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-950/30 border-t-emerald-950" />}{isSubmitting ? "Submitting..." : submission ? "Submitted" : "Submit"}</Button>
          </div>
          <div className="min-h-0 flex-1"><Editor height="100%" language={language} theme="vs-dark" value={code} onChange={(value) => setCode(value ?? "")} options={{ fontSize: 14, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", lineHeight: 22, lineNumbersMinChars: 3, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, wordWrap: "on", padding: { top: 18, bottom: 18 }, cursorSmoothCaretAnimation: "on" }} /></div>
          <section className="max-h-[38%] shrink-0 overflow-y-auto border-t border-slate-800 bg-white px-4 py-4 sm:px-5"><h2 className="text-sm font-semibold text-slate-900">Submission Result</h2>{!submission ? <p className="mt-2 text-sm text-slate-500">Submit your solution to see the result.</p> : <div className="mt-3"><p className={`text-lg font-semibold ${verdictStyles[submission.verdict] ?? "text-slate-900"}`}>{submission.verdict}</p><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600"><span><strong className="font-medium text-slate-800">Passed</strong> {submission.passedTestCases} / {submission.totalTestCases} tests</span><span><strong className="font-medium text-slate-800">Runtime</strong> {submission.maxRuntime} ms</span></div>{submission.errorMessage && <div className="mt-4"><p className="text-sm font-medium text-slate-800">Failure reason</p><pre className="mt-1.5 max-h-40 overflow-auto rounded-md border border-rose-200 bg-rose-50 p-3 font-mono text-xs leading-5 text-rose-800 whitespace-pre-wrap">{submission.errorMessage}</pre></div>}{submission.verdict === "Wrong Answer" && failedTest && <div className="mt-4"><p className="text-sm font-medium text-slate-800">Failed Test Case</p><div className="mt-2 grid gap-3 sm:grid-cols-3"><div><p className="text-xs font-medium text-slate-500">Input</p><CodeValue>{failedTest.input}</CodeValue></div><div><p className="text-xs font-medium text-slate-500">Expected</p><CodeValue>{failedTest.expected}</CodeValue></div><div><p className="text-xs font-medium text-slate-500">Your Output</p><CodeValue>{failedTest.received}</CodeValue></div></div></div>}</div>}</section>
        </section>
      </div>
    </main>
  );
}
