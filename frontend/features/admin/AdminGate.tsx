"use client";

import { RequireAuth } from "@/components/auth/RequireAuth";
import { ErrorState } from "@/components/layout/ErrorState";
import { useAuth } from "@/hooks/useAuth";

export function AdminGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <RequireAuth>{user?.role === "admin" ? children : <ErrorState title="Access denied" description="Administrator permissions are required." />}</RequireAuth>;
}
