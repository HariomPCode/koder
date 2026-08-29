"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";

type Difficulty = "Easy" | "Medium" | "Hard";
interface ProblemSummary { title: string; slug: string; difficulty: Difficulty; }
interface RecentSubmission { question: ProblemSummary; language: string; verdict: string; maxRuntime: number; createdAt: string; }
interface SolvedProblem extends ProblemSummary { solvedAt: string; }
interface Stats {
  totalSubmissions: number; solvedCount: number; attemptedCount: number; attemptedButUnsolved: number;
  acceptedSubmissions: number; acceptanceRate: number; solvedEasyQuestions: number;
  solvedMediumQuestions: number; solvedHardQuestions: number;
  availableByDifficulty: Record<Difficulty, number>;
  recentSubmissions: RecentSubmission[]; recentlySolved: SolvedProblem[];
  activity: { currentStreak: number; longestStreak: number; lastActive: string | null; weeklySolved: number; weeklyAttempted: number; };
  recommendation: ProblemSummary | null;
}

const verdictClasses: Record<string, string> = {
  Accepted: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  "Wrong Answer": "bg-amber-50 text-amber-700 ring-amber-600/15",
  "Runtime Error": "bg-rose-50 text-rose-700 ring-rose-600/15",
  "Compilation Error": "bg-rose-50 text-rose-700 ring-rose-600/15",
  "Time Limit Exceeded": "bg-orange-50 text-orange-700 ring-orange-600/15",
};
const difficultyColors: Record<Difficulty, string> = { Easy: "bg-emerald-500", Medium: "bg-amber-500", Hard: "bg-rose-500" };

function relativeTime(value: string | null) {
  if (!value) return "No submissions yet";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatCard({ title, value, detail }: { title: string; value: string | number; detail: string }) {
  return <Card><CardContent className="p-5"><p className="text-sm font-medium text-muted-foreground">{title}</p><p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</p><p className="mt-2 text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}

function ProgressRow({ label, solved, available }: { label: Difficulty; solved: number; available: number }) {
  const percentage = available ? Math.round((solved / available) * 100) : 0;
  return <div className="py-3"><div className="flex items-baseline justify-between gap-4"><div><p className="text-sm font-medium text-foreground">{label}</p><p className="mt-0.5 text-xs text-muted-foreground">{solved} solved · {available} available</p></div><span className="text-sm font-medium text-muted-foreground">{percentage}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${difficultyColors[label]}`} style={{ width: `${percentage}%` }} /></div></div>;
}

export default function Dashboard() {
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => { void fetchStats(); }, []);
  async function fetchStats() {
    try {
      const res = await fetch(`${backend}/api/v1/user/stats`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch dashboard stats");
      setStats(await res.json());
    } catch (err) { console.error(err); }
  }

  if (!stats) {
    return <main className="mx-auto w-full max-w-7xl p-6 sm:p-8"><div className="h-8 w-56 animate-pulse rounded bg-muted" /><div className="mt-3 h-4 w-80 max-w-full animate-pulse rounded bg-muted" /><div className="mt-10 grid grid-cols-2 gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl border bg-muted/40" />)}</div></main>;
  }

  const solvedByDifficulty: Record<Difficulty, number> = { Easy: stats.solvedEasyQuestions, Medium: stats.solvedMediumQuestions, Hard: stats.solvedHardQuestions };
  const latestSubmission = stats.recentSubmissions[0]?.createdAt ?? null;

  return <main className="mx-auto w-full max-w-7xl p-6 sm:p-8">
    <header className="mb-8"><h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Welcome back, {user?.firstName || "there"} <span aria-hidden="true">👋</span></h1><p className="mt-2 text-sm text-muted-foreground sm:text-base">Keep solving problems and improve your coding skills.</p></header>

    <section aria-label="Progress overview" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard title="Solved" value={stats.solvedCount} detail={stats.activity.weeklySolved ? `+${stats.activity.weeklySolved} solved this week` : "Problems solved"} />
      <StatCard title="Attempted" value={stats.attemptedCount} detail={stats.activity.weeklyAttempted ? `+${stats.activity.weeklyAttempted} attempted this week` : "Problems attempted"} />
      <StatCard title="Acceptance" value={`${stats.acceptanceRate}%`} detail={`${stats.acceptedSubmissions} / ${stats.totalSubmissions} accepted`} />
      <StatCard title="Submissions" value={stats.totalSubmissions} detail={latestSubmission ? `Latest: ${relativeTime(latestSubmission)}` : "No submissions yet"} />
    </section>

    <section className="mt-6 grid gap-6 lg:grid-cols-2">
      <Card><CardContent className="p-6"><h2 className="text-lg font-semibold text-foreground">Difficulty Breakdown</h2><div className="mt-3 divide-y">{(["Easy", "Medium", "Hard"] as Difficulty[]).map((difficulty) => <ProgressRow key={difficulty} label={difficulty} solved={solvedByDifficulty[difficulty]} available={stats.availableByDifficulty[difficulty]} />)}</div></CardContent></Card>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Card><CardContent className="p-6"><h2 className="text-lg font-semibold text-foreground">Acceptance Rate</h2><p className="mt-4 text-3xl font-semibold tracking-tight">{stats.acceptanceRate}%</p><p className="mt-1 text-sm text-muted-foreground">{stats.acceptedSubmissions} accepted · {stats.totalSubmissions} total submissions</p></CardContent></Card>
        <Card><CardContent className="p-6"><h2 className="text-lg font-semibold text-foreground">Activity</h2>{stats.activity.lastActive ? <div className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><p className="text-2xl font-semibold">{stats.activity.currentStreak}</p><p className="text-muted-foreground">Current streak</p></div><div><p className="text-2xl font-semibold">{stats.activity.longestStreak}</p><p className="text-muted-foreground">Longest streak</p></div><p className="col-span-2 text-xs text-muted-foreground">Last active {relativeTime(stats.activity.lastActive)}</p></div> : <p className="mt-4 text-sm text-muted-foreground">No active streak yet.</p>}</CardContent></Card>
      </div>
    </section>

    <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,1fr)]">
      <Card><CardContent className="p-6"><h2 className="text-lg font-semibold text-foreground">Recent Submissions</h2>{stats.recentSubmissions.length ? <><div className="mt-4 hidden grid-cols-[minmax(0,1fr)_5rem_7.5rem_4.5rem_4.5rem] gap-3 border-b pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid"><span>Problem</span><span>Language</span><span>Verdict</span><span>Runtime</span><span>When</span></div><div className="divide-y">{stats.recentSubmissions.map((submission, index) => <div key={`${submission.question.slug}-${submission.createdAt}-${index}`} className="py-3"><div className="hidden grid-cols-[minmax(0,1fr)_5rem_7.5rem_4.5rem_4.5rem] items-center gap-3 md:grid"><Link href={`/problems/${submission.question.slug}`} className="truncate text-sm font-medium text-foreground hover:underline">{submission.question.title}</Link><span className="text-sm text-muted-foreground">{submission.language}</span><span><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${verdictClasses[submission.verdict] ?? "bg-muted text-muted-foreground ring-border"}`}>{submission.verdict}</span></span><span className="text-sm text-muted-foreground">{submission.maxRuntime ? `${submission.maxRuntime} ms` : "—"}</span><span className="text-sm text-muted-foreground">{relativeTime(submission.createdAt)}</span></div><div className="md:hidden"><div className="flex items-start justify-between gap-3"><Link href={`/problems/${submission.question.slug}`} className="text-sm font-medium text-foreground hover:underline">{submission.question.title}</Link><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${verdictClasses[submission.verdict] ?? "bg-muted text-muted-foreground ring-border"}`}>{submission.verdict}</span></div><p className="mt-1 text-xs text-muted-foreground">{submission.language} · {submission.maxRuntime ? `${submission.maxRuntime} ms · ` : ""}{relativeTime(submission.createdAt)}</p></div></div>)}</div></> : <p className="mt-4 text-sm text-muted-foreground">Submit your first solution to start tracking your progress.</p>}</CardContent></Card>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
        <Card><CardContent className="p-6"><h2 className="text-lg font-semibold text-foreground">Recently Solved</h2>{stats.recentlySolved.length ? <ul className="mt-3 divide-y">{stats.recentlySolved.slice(0, 4).map((problem) => <li key={problem.slug}><Link href={`/problems/${problem.slug}`} className="flex items-start gap-3 py-3 focus-visible:outline-none"><span className="mt-0.5 text-emerald-600" aria-hidden="true">✓</span><span><span className="block text-sm font-medium text-foreground hover:underline">{problem.title}</span><span className="mt-0.5 block text-xs text-muted-foreground">Solved {relativeTime(problem.solvedAt)} · {problem.difficulty}</span></span></Link></li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">Solve your first problem to see it here.</p>}</CardContent></Card>
        <Card><CardContent className="p-6"><h2 className="text-lg font-semibold text-foreground">Keep Going</h2>{stats.recommendation ? <><p className="mt-3 text-sm leading-6 text-muted-foreground">You have solved {stats.solvedEasyQuestions} Easy problems. Next, try an unsolved {stats.recommendation.difficulty} problem.</p><Link href={`/problems/${stats.recommendation.slug}`} className="mt-4 inline-flex text-sm font-semibold text-foreground underline underline-offset-4">Try {stats.recommendation.title} →</Link></> : <p className="mt-3 text-sm leading-6 text-muted-foreground">You&apos;ve completed all available problems.</p>}</CardContent></Card>
      </div>
    </section>

    <section className="mt-6 grid gap-4 sm:grid-cols-2"><Card><CardContent className="p-5"><p className="text-sm font-medium text-muted-foreground">Accepted Submissions</p><p className="mt-2 text-3xl font-semibold">{stats.acceptedSubmissions}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm font-medium text-muted-foreground">Attempted but Unsolved</p><p className="mt-2 text-3xl font-semibold">{stats.attemptedButUnsolved}</p></CardContent></Card></section>
  </main>;
}
