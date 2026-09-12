import type { Submission } from "@/types/api";

import { VERDICT_PRESENTATION } from "@/lib/constants/verdict";
import { WorkspaceCodeValue } from "./WorkspaceCodeValue";

export function ResultDrawer({ submission }: { submission: Submission | null }) {
  const failedTest = submission?.failedTestCase;

  return (
    <section className="max-h-[38%] shrink-0 overflow-y-auto border-t border-zinc-800 bg-card px-4 py-4 sm:px-5">
      <h2 className="text-sm font-semibold text-foreground">Submission Result</h2>
      {!submission ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Submit your solution to see the result.
        </p>
      ) : (
        <div className="mt-3">
          <p
            className={`text-lg font-semibold ${VERDICT_PRESENTATION[submission.verdict ?? "pending"]?.className ?? VERDICT_PRESENTATION.pending.className}`}
          >
            {submission.verdict}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span>
              <strong className="font-medium text-foreground">Passed</strong>{" "}
              {submission.passedTestCases} / {submission.totalTestCases} tests
            </span>
            <span>
              <strong className="font-medium text-foreground">Runtime</strong>{" "}
              {submission.maxRuntime} ms
            </span>
          </div>
          {submission.errorMessage && (
            <div className="mt-4">
              <p className="text-sm font-medium text-foreground">Failure reason</p>
              <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 p-3 font-mono text-xs leading-5 text-rose-800">
                {submission.errorMessage}
              </pre>
            </div>
          )}
          {submission.verdict === "Wrong Answer" && failedTest && (
            <div className="mt-4">
              <p className="text-sm font-medium text-foreground">Failed Test Case</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Input</p>
                  <WorkspaceCodeValue>{failedTest.input}</WorkspaceCodeValue>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Expected</p>
                  <WorkspaceCodeValue>{failedTest.expected}</WorkspaceCodeValue>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Your Output</p>
                  <WorkspaceCodeValue>{failedTest.received}</WorkspaceCodeValue>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
