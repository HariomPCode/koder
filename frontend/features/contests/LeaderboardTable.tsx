"use client";

import type { Standing } from "@/types/api";

export function LeaderboardTable({ standings }: { standings: Standing[] }) {
  if (!standings.length) {
    return <p className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">No standings available yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr><th className="px-4 py-3">Rank</th><th className="px-4 py-3">Participant</th><th className="px-4 py-3">Solved</th><th className="px-4 py-3">Score</th><th className="px-4 py-3">Penalty</th></tr>
        </thead>
        <tbody className="divide-y divide-border bg-card">
          {standings.map((standing) => (
            <tr key={standing.userId}>
              <td className="px-4 py-3 font-semibold text-foreground">{standing.rank}</td>
              <td className="px-4 py-3 text-foreground">{standing.user ? `${standing.user.firstName} ${standing.user.lastName}` : standing.userId}</td>
              <td className="px-4 py-3 text-muted-foreground">{standing.solvedCount}</td>
              <td className="px-4 py-3 text-muted-foreground">{standing.score}</td>
              <td className="px-4 py-3 text-muted-foreground">{standing.penalty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
