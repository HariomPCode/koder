"use client";

import { toast } from "@/components/ui/toast";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface Problem {
  _id: string;
  questionNum: number;
  title: string;
  slug: string;
  difficulty: "Easy" | "Medium" | "Hard";
  tags: string[];
}

type DifficultyFilter = "All" | "Easy" | "Medium" | "Hard";

function Problems() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const backendUri = process.env.NEXT_PUBLIC_BACKEND_URL;

  useEffect(() => {
    fetchQuestions();
  }, []);

  const fetchQuestions = async () => {
    try {
      setLoading(true);
      setError("");

      const res = await fetch(
        `${backendUri}/api/v1/questions?page=1&limit=20`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
        },
      );

      if (!res.ok) {
        throw new Error("Failed to fetch questions");
      }

      const data = await res.json();

      setProblems(data.questions || []);

      toast.add({
        type: "success",
        description: data.message,
      });
    } catch (error) {
      console.error(error);
      setError("Unable to load problems. Please try again.");
    } finally {
      setLoading(false);
    }
  };

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

  const difficultyStyles = {
    Easy: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Medium: "bg-amber-50 text-amber-700 border-amber-200",
    Hard: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <section className="mb-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">
                Problems
              </h1>
            </div>

            {!loading && !error && (
              <div className="text-sm text-gray-500">
                <span className="font-semibold text-gray-900">
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
                  className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100"
                />
              </div>

              {/* Difficulty filters */}
              <div className="flex flex-wrap gap-2">
                {(["All", "Easy", "Medium", "Hard"] as DifficultyFilter[]).map(
                  (filter) => {
                    const active = difficulty === filter;

                    return (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setDifficulty(filter)}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                          active
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {filter}

                        <span
                          className={`ml-1.5 ${
                            active ? "text-gray-300" : "text-gray-400"
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
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="animate-pulse">
              {[1, 2, 3, 4, 5].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-4 border-b border-gray-100 px-5 py-5 last:border-b-0"
                >
                  <div className="h-4 w-8 rounded bg-gray-200" />
                  <div className="h-4 flex-1 max-w-xs rounded bg-gray-200" />
                  <div className="hidden h-4 w-32 rounded bg-gray-200 sm:block" />
                  <div className="h-6 w-16 rounded-full bg-gray-200" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-white p-8 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600">
              !
            </div>

            <h2 className="font-semibold text-gray-900">
              Something went wrong
            </h2>

            <p className="mt-1 text-sm text-gray-500">{error}</p>

            <button
              type="button"
              onClick={fetchQuestions}
              className="mt-5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              Try again
            </button>
          </div>
        )}

        {/* Problem list */}
        {!loading && !error && (
          <>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              {/* Desktop table header */}
              <div className="hidden grid-cols-[64px_minmax(0,1fr)_220px_110px] items-center gap-4 border-b border-gray-200 bg-gray-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 md:grid">
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
                    className="group block border-b border-gray-100 px-5 py-4 transition last:border-b-0 hover:bg-gray-50"
                  >
                    {/* Desktop */}
                    <div className="hidden grid-cols-[64px_minmax(0,1fr)_220px_110px] items-center gap-4 md:grid">
                      <span className="text-sm tabular-nums text-gray-400">
                        {problem.questionNum}
                      </span>

                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold text-gray-900 transition group-hover:text-black">
                          {problem.title}
                        </h2>
                      </div>

                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        {problem.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500"
                          >
                            {tag}
                          </span>
                        ))}

                        {problem.tags.length > 3 && (
                          <span className="px-1 py-1 text-xs text-gray-400">
                            +{problem.tags.length - 3}
                          </span>
                        )}
                      </div>

                      <span
                        className={`w-fit rounded-full border px-2.5 py-1 text-xs font-medium ${
                          difficultyStyles[problem.difficulty]
                        }`}
                      >
                        {problem.difficulty}
                      </span>
                    </div>

                    {/* Mobile */}
                    <div className="md:hidden">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 gap-3">
                          <span className="pt-0.5 text-sm tabular-nums text-gray-400">
                            {problem.questionNum}
                          </span>

                          <div className="min-w-0">
                            <h2 className="text-sm font-semibold text-gray-900">
                              {problem.title}
                            </h2>

                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {problem.tags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${
                            difficultyStyles[problem.difficulty]
                          }`}
                        >
                          {problem.difficulty}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="px-6 py-16 text-center">
                  <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                    ?
                  </div>

                  <h2 className="font-semibold text-gray-900">
                    No problems found
                  </h2>

                  <p className="mt-1 text-sm text-gray-500">
                    Try changing your search or difficulty filter.
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setDifficulty("All");
                    }}
                    className="mt-4 text-sm font-medium text-gray-900 underline underline-offset-4"
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>

            {/* Result count */}
            {filteredProblems.length > 0 && (
              <p className="mt-4 text-center text-xs text-gray-400">
                Showing {filteredProblems.length} of {problems.length} problems
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default Problems;
