"use client";
import { useEffect, useState } from "react";
import { AdminGate } from "@/features/admin/AdminGate";
import { PageContainer } from "@/components/layout/PageContainer";
import { ErrorState } from "@/components/layout/ErrorState";
import { EmptyState } from "@/components/layout/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi } from "@/lib/api/admin";
import type { User } from "@/types/api";
import { useAuth } from "@/hooks/useAuth";
export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[] | null>(null); const [page, setPage] = useState(1); const [pagination, setPagination] = useState<{ totalPages: number } | null>(null); const [error, setError] = useState<string | null>(null); const { user, status } = useAuth();
  useEffect(() => { if (status !== "authenticated" || user?.role !== "admin") return; void adminApi.getUsers(page).then((data) => { setUsers(data.users); setPagination(data.pagination); }).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load users.")); }, [page, status, user?.role]);
  return <AdminGate><PageContainer><h1 className="text-3xl font-bold text-foreground">Manage users</h1>{error ? <div className="mt-8"><ErrorState title="Unable to load users" description={error} /></div> : !users ? <Skeleton className="mt-8 h-56" /> : users.length === 0 ? <div className="mt-8"><EmptyState title="No users found" description="There are no users on this page." /></div> : <div className="mt-8"><div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[48rem] text-left text-sm"><thead className="bg-muted text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Rating</th><th className="px-4 py-3">Joined</th></tr></thead><tbody className="divide-y divide-border bg-card">{users.map((item) => <tr key={item._id}><td className="px-4 py-3">{item.firstName} {item.lastName}</td><td className="px-4 py-3">{item.email}</td><td className="px-4 py-3">{item.role}</td><td className="px-4 py-3">{item.rating ?? "—"}</td><td className="px-4 py-3">{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "—"}</td></tr>)}</tbody></table></div>{pagination && pagination.totalPages > 1 ? <div className="mt-4 flex justify-between text-sm"><button disabled={page <= 1} onClick={() => setPage(page - 1)} className="underline disabled:opacity-50">Previous</button><span>Page {page} of {pagination.totalPages}</span><button disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)} className="underline disabled:opacity-50">Next</button></div> : null}</div>}</PageContainer></AdminGate>;
}
