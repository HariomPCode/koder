import type { ProblemDetail } from "@/types/api";

import { DIFFICULTY_PRESENTATION } from "@/lib/constants/difficulty";
import { WorkspaceCodeValue } from "./WorkspaceCodeValue";

export function StatementPane({ problem }: { problem: ProblemDetail | null }) {
  return (
    <section className="min-h-0 shrink-0 overflow-y-auto border-b border-border bg-card md:border-b-0 md:border-r">
      <div className="mx-auto max-w-3xl px-5 py-7 sm:px-7">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {problem
              ? `${problem.questionNum}. ${problem.title}`
              : "Loading problem…"}
          </h1>
          {problem && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${DIFFICULTY_PRESENTATION[problem.difficulty].badge}`}
            >
              {problem.difficulty}
            </span>
          )}
        </div>

        {problem && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Description
            </h2>
            <p className="mt-3 whitespace-pre-wrap leading-7 text-foreground">
              {problem.description}
            </p>
          </section>
        )}

        {problem && (
          <section className="mt-9">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Examples
            </h2>
            <div className="mt-4 space-y-5">
              {problem.sampleTestCases.map((testcase, index) => (
                <div key={index}>
                  <h3 className="text-sm font-semibold text-foreground">
                    Example {index + 1}
                  </h3>
                  <div className="mt-2 grid gap-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Input</p>
                      <WorkspaceCodeValue>{testcase.input}</WorkspaceCodeValue>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Output</p>
                      <WorkspaceCodeValue>{testcase.output}</WorkspaceCodeValue>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {problem && (
          <section className="mt-9">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Constraints
            </h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-foreground">
              {problem.constraints.map((constraint, index) => (
                <li key={index} className="flex gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>{constraint}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {problem && (
          <section className="mt-9">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Topics
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {problem.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
