"use client";

import Link from "next/link";
import { AdminGate } from "@/features/admin/AdminGate";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate><div className="min-h-[calc(100dvh-4rem)]"><nav aria-label="Admin navigation" className="border-b border-border bg-card"><div className="mx-auto flex max-w-7xl flex-wrap gap-5 px-4 py-3 text-sm font-medium sm:px-6"><Link href="/admin/contests">Contests</Link><Link href="/admin/questions">Questions</Link><Link href="/admin/users">Users</Link></div></nav>{children}</div></AdminGate>;
}
