"use client";

import { api } from "@/lib/api-client";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { DIFFICULTIES, DIFFICULTY_PRESENTATION } from "@/lib/constants/difficulty";
import type { Difficulty, ProblemListItem, QuestionsResponse } from "@/types/api";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type DifficultyFilter = "All" | Difficulty;

function Problems() {
  const [problems, setProblems] = useState<ProblemListItem[]>([]);
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchQuestions = async () => {
    try {
      setLoading(true);
      setError("");

      const data = await api.get<QuestionsResponse>(
        "/api/v1/questions?page=1&limit=20",
      );

      setProblems(data.questions || []);

    } catch (error) {
      console.error(error);
      setError("Unable to load problems. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial route data is loaded after the component mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchQuestions();
  }, []);

  const filteredProblems = useMemo(() => {
    const query = search.trim().toLowerCase();

    return problems.filter((problem) => {
      const matchesSearch =
        !query ||
        problem.title.toLowerCase().includes(query) ||
        problem.tags.some((tag) => tag.toLowerCase().includes(query)) ||
        problem.questionNum.toString().includes(query);

      const matchesDifficulty =
        difficulty === "All" || problem.difficulty === difficulty;

      return matchesSearch && matchesDifficulty;
    });
  }, [problems, search, difficulty]);

  const difficultyCounts = useMemo(() => {
    return {
      All: problems.length,
      Easy: problems.filter((p) => p.difficulty === "Easy").length,
      Medium: problems.filter((p) => p.difficulty === "Medium").length,
      Hard: problems.filter((p) => p.difficulty === "Hard").length,
    };
  }, [problems]);

  return (
    <PageContainer className="max-w-6xl">
        {/* Header */}
        <section className="mb-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">
                Problems
              </h1>
            </div>

            {!loading && !error && (
              <div className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">
                  {problems.length}
                </span>{" "}
                problems available
              </div>
            )}
          </div>
        </section>

        {/* Filters */}
        {!loading && !error && (
          <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              {/* Search */}
              <div className="relative w-full lg:max-w-md">
                <svg
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>

                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search problems or topics..."
                  className="h-10 w-full rounded-lg border border-input bg-background pl-10 pr-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                />
              </div>

              {/* Difficulty filters */}
              <div className="flex flex-wrap gap-2">
                {(["All", ...DIFFICULTIES] as DifficultyFilter[]).map(
                  (filter) => {
                    const active = difficulty === filter;

                    return (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setDifficulty(filter)}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {filter}

                        <span
                          className={`ml-1.5 ${
                            active ? "text-primary-foreground/70" : "text-muted-foreground"
                          }`}
                        >
                          {difficultyCounts[filter]}
                        </span>
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          </section>
        )}

        {/* Loading */}
        {loading && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div>
              {[1, 2, 3, 4, 5].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-4 border-b border-border px-5 py-5 last:border-b-0"
                >
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="h-4 max-w-xs flex-1" />
                  <Skeleton className="hidden h-4 w-32 sm:block" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <ErrorState description={error} action={{ label: "Try again", onClick: fetchQuestions }} />
        )}

        {/* Problem list */}
        {!loading && !error && (
          <>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {/* Desktop table header */}
              <div className="hidden grid-cols-[64px_minmax(0,1fr)_220px_110px] items-center gap-4 border-b border-border bg-muted/40 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                <span>#</span>
                <span>Problem</span>
                <span>Topics</span>
                <span>Difficulty</span>
              </div>

              {filteredProblems.length > 0 ? (
                filteredProblems.map((problem) => (
                  <Link
                    key={problem._id}
                    href={`/problems/${problem.slug}`}
                    className="group block border-b border-border px-5 py-4 transition last:border-b-0 hover:bg-muted/40"
                  >
                    {/* Desktop */}
                    <div className="hidden grid-cols-[64px_minmax(0,1fr)_220px_110px] items-center gap-4 md:grid">
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {problem.questionNum}
                      </span>

                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold text-foreground transition group-hover:text-primary">
                          {problem.title}
                        </h2>
                      </div>

                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        {problem.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}

                        {problem.tags.length > 3 && (
                          <span className="px-1 py-1 text-xs text-muted-foreground">
                            +{problem.tags.length - 3}
                          </span>
                        )}
                      </div>

                      <span
                        className={`w-fit rounded-full border px-2.5 py-1 text-xs font-medium ${DIFFICULTY_PRESENTATION[problem.difficulty].badge}`}
                      >
                        {problem.difficulty}
                      </span>
                    </div>

                    {/* Mobile */}
                    <div className="md:hidden">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 gap-3">
                          <span className="pt-0.5 text-sm tabular-nums text-muted-foreground">
                            {problem.questionNum}
                          </span>

                          <div className="min-w-0">
                            <h2 className="text-sm font-semibold text-foreground">
                              {problem.title}
                            </h2>

                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {problem.tags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${DIFFICULTY_PRESENTATION[problem.difficulty].badge}`}
                        >
                          {problem.difficulty}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <EmptyState
                  title="No problems found"
                  description="Try changing your search or difficulty filter."
                  action={{
                    label: "Clear filters",
                    onClick: () => {
                      setSearch("");
                      setDifficulty("All");
                    },
                  }}
                />
              )}
            </div>

            {/* Result count */}
            {filteredProblems.length > 0 && (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Showing {filteredProblems.length} of {problems.length} problems
              </p>
            )}
          </>
        )}
    </PageContainer>
  );
}

export default Problems;
