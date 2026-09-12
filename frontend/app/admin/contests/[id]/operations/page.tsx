"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AdminGate } from "@/features/admin/AdminGate";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/layout/ErrorState";
import { adminApi, getLeaderboardOperationError } from "@/lib/api/admin";

export default function OperationsPage() {
  const { id } = useParams(); const contestId = Array.isArray(id) ? id[0] : id;
  const [result, setResult] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [pending, setPending] = useState(false);
  const run = async (operation: "rebuildLeaderboard" | "preseedLeaderboard" | "cleanupLeaderboard") => {
    if (!contestId || !window.prompt("Type LEADERBOARD to confirm this operational action.")?.trim().toUpperCase().includes("LEADERBOARD")) return;
    setPending(true); setError(null); setResult(null);
    try { const response = await adminApi[operation](contestId, "Confirmed leaderboard maintenance operation"); setResult(`${operation}: ${response.status ?? "accepted"}`); }
    catch (caught) { setError(getLeaderboardOperationError(caught)); }
    finally { setPending(false); }
  };
  const health = async () => { if (!contestId) return; setPending(true); setError(null); try { const response = await adminApi.getLeaderboardHealth(contestId); setResult(`health: ${response.status ?? "ok"}`); } catch (caught) { setError(getLeaderboardOperationError(caught)); } finally { setPending(false); } };
  return <AdminGate><PageContainer><h1 className="text-3xl font-bold text-foreground">Leaderboard operations</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">These recovery tools can rebuild or remove scoring projections. They are separate from normal contest administration and require typed confirmation.</p>{error ? <div className="mt-6"><ErrorState title="Operation failed" description={error} /></div> : null}{result ? <p role="status" className="mt-6 rounded-md border border-border bg-card p-3 text-sm text-foreground">{result}</p> : null}<div className="mt-8 grid gap-4 sm:grid-cols-2"><Operation title="Health check" description="Inspect projection drift without changing data." action={() => void health()} label="Check health" /><Operation title="Rebuild" description="Recompute and publish the contest leaderboard." action={() => void run("rebuildLeaderboard")} label="Rebuild leaderboard" /><Operation title="Preseed" description="Prepare retention data for the contest." action={() => void run("preseedLeaderboard")} label="Preseed leaderboard" /><Operation title="Cleanup" description="Remove retained leaderboard operational data." action={() => void run("cleanupLeaderboard")} label="Cleanup leaderboard" /></div>{pending ? <p className="mt-4 text-sm text-muted-foreground">Operation in progress...</p> : null}</PageContainer></AdminGate>;
}
function Operation({ title, description, action, label }: { title: string; description: string; action: () => void; label: string }) { return <section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold text-foreground">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{description}</p><Button variant={title === "Health check" ? "outline" : "destructive"} className="mt-4" onClick={action}>{label}</Button></section>; }
