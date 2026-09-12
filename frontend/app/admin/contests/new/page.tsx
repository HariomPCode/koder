"use client";
import { useRouter } from "next/navigation";
import { AdminGate } from "@/features/admin/AdminGate";
import { ContestForm } from "@/features/admin/ContestForm";
import { PageContainer } from "@/components/layout/PageContainer";
export default function NewContestPage() { const router = useRouter(); return <AdminGate><PageContainer><h1 className="text-3xl font-bold text-foreground">New contest</h1><div className="mt-8"><ContestForm onSaved={() => router.push("/admin/contests")} /></div></PageContainer></AdminGate>; }
