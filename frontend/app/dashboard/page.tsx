"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";

interface Stats {
  totalSubmissions: number;
  solvedCount: number;
  attemptedCount: number;
  attemptedButUnsolved: number;
  acceptedSubmissions: number;
  acceptanceRate: number;
  solvedEasyQuestions: number;
  solvedMediumQuestions: number;
  solvedHardQuestions: number;
}

export default function Dashboard() {
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL;

  const { user } = useAuth();

  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    try {
      const res = await fetch(`${backend}/api/v1/user/stats`, {
        credentials: "include",
      });

      const data = await res.json();

      setStats(data);
    } catch (err) {
      console.error(err);
    }
  }

  if (!stats) {
    return <div className="flex justify-center mt-20">Loading...</div>;
  }

  return (
    <main className="max-w-7xl mx-auto p-8">
      <div className="mb-10">
        <h1 className="text-4xl font-bold">
          Welcome back, {user?.firstName}
          👋
        </h1>

        <p className="text-muted-foreground mt-2">
          Keep solving problems and improve your coding skills.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <StatCard title="Solved" value={stats.solvedCount} />

        <StatCard title="Attempted" value={stats.attemptedCount} />

        <StatCard title="Acceptance" value={`${stats.acceptanceRate}%`} />

        <StatCard title="Submissions" value={stats.totalSubmissions} />
      </div>

      <Card className="mt-8">
        <CardContent className="p-6">
          <h2 className="text-2xl font-semibold mb-6">Difficulty Breakdown</h2>

          <ProgressRow
            label="Easy"
            color="bg-green-500"
            value={stats.solvedEasyQuestions}
          />

          <ProgressRow
            label="Medium"
            color="bg-yellow-500"
            value={stats.solvedMediumQuestions}
          />

          <ProgressRow
            label="Hard"
            color="bg-red-500"
            value={stats.solvedHardQuestions}
          />
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6 mt-8">
        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold text-lg">Accepted Submissions</h3>

            <p className="text-4xl mt-4">{stats.acceptedSubmissions}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold text-lg">Attempted but Unsolved</h3>

            <p className="text-4xl mt-4">{stats.attemptedButUnsolved}</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function StatCard({ title, value }: { title: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-muted-foreground">{title}</p>

        <h2 className="text-4xl font-bold mt-2">{value}</h2>
      </CardContent>
    </Card>
  );
}

function ProgressRow({
  label,
  color,
  value,
}: {
  label: string;
  color: string;
  value: number;
}) {
  return (
    <div className="mb-5">
      <div className="flex justify-between mb-2">
        <span>{label}</span>

        <span>{value}</span>
      </div>

      <div className="w-full h-3 bg-muted rounded-full">
        <div
          className={`${color} h-3 rounded-full`}
          style={{
            width: `${Math.min(value * 20, 100)}%`,
          }}
        />
      </div>
    </div>
  );
}
