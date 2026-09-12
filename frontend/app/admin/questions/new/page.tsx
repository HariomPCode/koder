"use client";
import { useRouter } from "next/navigation";
import { AdminGate } from "@/features/admin/AdminGate";
import { QuestionForm } from "@/features/admin/QuestionForm";
import { PageContainer } from "@/components/layout/PageContainer";
export default function NewQuestionPage() { const router = useRouter(); return <AdminGate><PageContainer><h1 className="text-3xl font-bold text-foreground">New question</h1><div className="mt-8"><QuestionForm onSaved={() => router.push("/admin/questions")} /></div></PageContainer></AdminGate>; }
