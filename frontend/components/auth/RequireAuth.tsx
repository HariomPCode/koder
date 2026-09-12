"use client";

import { ErrorState } from "@/components/layout/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useRequireAuth } from "@/hooks/useRequireAuth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, error, accessDenied } = useRequireAuth();

  if (status === "checking") {
    return (
      <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-7xl p-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-4 h-4 w-80 max-w-full" />
      </main>
    );
  }

  if (status === "error") {
    return (
      <ErrorState
        className="mx-auto mt-12 max-w-xl"
        title="Authentication unavailable"
        description={error ?? "Unable to verify your session."}
        action={{ label: "Try again", onClick: () => window.location.reload() }}
      />
    );
  }

  if (accessDenied) {
    return (
      <ErrorState
        className="mx-auto mt-12 max-w-xl"
        title="Access denied"
        description="You do not have permission to access this resource."
      />
    );
  }

  if (status !== "authenticated") return null;
  return <>{children}</>;
}
