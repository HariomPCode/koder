"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import {
  DIFFICULTIES,
  DIFFICULTY_PRESENTATION,
} from "@/lib/constants/difficulty";
import type {
  Difficulty,
  ProblemListItem,
  QuestionsResponse,
} from "@/types/api";

type DifficultyFilter = "All" | Difficulty;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [20, 50, 100] as const;

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function ProblemsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = parsePositiveInt(searchParams.get("page"), 1);
  const limit = Math.min(
    parsePositiveInt(searchParams.get("limit"), DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const search = searchParams.get("search") ?? "";
  const difficulty = (searchParams.get("difficulty") ?? "All") as DifficultyFilter;
  const hasFilters = Boolean(search.trim()) || difficulty !== "All";
  const requestLimit = hasFilters ? MAX_LIMIT : limit;

  const [problems, setProblems] = useState<ProblemListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const updateQuery = (updates: Record<string, string | number | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === "") next.delete(key);
      else next.set(key, String(value));
    });
    router.push(`${pathname}?${next.toString()}`);
  };

  const fetchQuestions = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await api.get<QuestionsResponse>(
        `/api/v1/questions?page=${hasFilters ? 1 : page}&limit=${requestLimit}`,
      );
      setProblems(data.questions ?? []);
    } catch (caughtError) {
      console.error(caughtError);
      setError("Unable to load problems. Please try again.");
      setProblems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasFilters && page !== 1) {
      updateQuery({ page: 1, limit: MAX_LIMIT });
      return;
    }
    // Query changes intentionally trigger the request and its loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchQuestions();
    // Query state is the deliberate trigger for server-driven loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, requestLimit, search, difficulty, hasFilters]);

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
  }, [difficulty, problems, search]);

  const difficultyCounts = useMemo(
    () => ({
      All: problems.length,
      Easy: problems.filter((problem) => problem.difficulty === "Easy").length,
      Medium: problems.filter((problem) => problem.difficulty === "Medium").length,
      Hard: problems.filter((problem) => problem.difficulty === "Hard").length,
    }),
    [problems],
  );

  const hasNextPage = !hasFilters && problems.length === requestLimit;

  return (
    <PageContainer className="max-w-6xl">
      <section className="mb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Problems
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Browse the problem catalog and choose your next challenge.
            </p>
          </div>
          {!loading && !error ? (
            <p className="text-sm text-muted-foreground">
              Page <span className="font-semibold text-foreground">{page}</span>
              {" · "}
              {hasFilters
                ? "Filtering the first 100 problems returned"
                : `${problems.length} problems on this page`}
            </p>
          ) : null}
        </div>
      </section>

      {!loading && !error ? (
        <section className="mb-5 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="w-full lg:max-w-md">
              <label htmlFor="problem-search" className="sr-only">
                Search problems
              </label>
              <input
                id="problem-search"
                type="search"
                value={search}
                onChange={(event) =>
                  updateQuery({
                    search: event.target.value,
                    page: 1,
                    limit: event.target.value ? MAX_LIMIT : limit,
                  })
                }
                placeholder="Search problems or topics..."
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-2" aria-label="Difficulty filter">
                {(["All", ...DIFFICULTIES] as DifficultyFilter[]).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={difficulty === filter}
                    onClick={() =>
                      updateQuery({
                        difficulty: filter === "All" ? null : filter,
                        page: 1,
                        limit: filter === "All" ? limit : MAX_LIMIT,
                      })
                    }
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      difficulty === filter
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {filter}
                    <span className="ml-1.5 text-xs opacity-75">
                      {difficultyCounts[filter]}
                    </span>
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Per page</span>
                <Select
                  aria-label="Problems per page"
                  value={String(limit)}
                  onChange={(event) =>
                    updateQuery({ limit: Math.min(Number(event.target.value), MAX_LIMIT), page: 1 })
                  }
                  className="w-20"
                >
                  {LIMIT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          </div>
          {hasFilters ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Search and difficulty filtering are currently applied to the first
              100 problems because the backend does not yet support filter
              query parameters.
            </p>
          ) : null}
        </section>
      ) : null}

      {loading ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {[1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="flex items-center gap-4 border-b border-border px-5 py-5">
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-4 max-w-xs flex-1" />
              <Skeleton className="hidden h-4 w-32 sm:block" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState description={error} action={{ label: "Try again", onClick: fetchQuestions }} />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="hidden grid-cols-[64px_minmax(0,1fr)_220px_110px] items-center gap-4 border-b border-border bg-muted/40 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
              <span>#</span><span>Problem</span><span>Topics</span><span>Difficulty</span>
            </div>
            {filteredProblems.length > 0 ? (
              filteredProblems.map((problem) => (
                <Link
                  key={problem._id}
                  href={`/problems/${problem.slug}`}
                  className="group block border-b border-border px-5 py-4 transition last:border-b-0 hover:bg-muted/40"
                >
                  <div className="hidden grid-cols-[64px_minmax(0,1fr)_220px_110px] items-center gap-4 md:grid">
                    <span className="text-sm tabular-nums text-muted-foreground">{problem.questionNum}</span>
                    <h2 className="truncate text-sm font-semibold text-foreground transition group-hover:text-primary">{problem.title}</h2>
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      {problem.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{tag}</span>
                      ))}
                    </div>
                    <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-medium ${DIFFICULTY_PRESENTATION[problem.difficulty].badge}`}>
                      {problem.difficulty}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-4 md:hidden">
                    <div className="flex min-w-0 gap-3">
                      <span className="pt-0.5 text-sm tabular-nums text-muted-foreground">{problem.questionNum}</span>
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-foreground">{problem.title}</h2>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {problem.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${DIFFICULTY_PRESENTATION[problem.difficulty].badge}`}>
                      {problem.difficulty}
                    </span>
                  </div>
                </Link>
              ))
            ) : (
              <EmptyState
                title="No problems found"
                description="Try changing your search or difficulty filter."
                action={{
                  label: "Clear filters",
                  onClick: () => updateQuery({ search: null, difficulty: null, page: 1, limit }),
                }}
              />
            )}
          </div>

          {filteredProblems.length > 0 ? (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Showing {filteredProblems.length} matching results from{" "}
              {hasFilters ? "the first 100 fetched problems" : `page ${page}`}
            </p>
          ) : null}

          {!hasFilters ? (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationLink
                    aria-label="Previous page"
                    disabled={page === 1}
                    onClick={() => updateQuery({ page: page - 1 })}
                  >
                    Previous
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink aria-current="page" disabled>
                    Page {page}
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink
                    aria-label="Next page"
                    disabled={!hasNextPage}
                    onClick={() => updateQuery({ page: page + 1 })}
                  >
                    Next
                  </PaginationLink>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}

export default function Problems() {
  return (
    <Suspense fallback={<PageContainer><Skeleton className="h-8 w-56" /></PageContainer>}>
      <ProblemsContent />
    </Suspense>
  );
}
