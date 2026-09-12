"use client";

import { useParams } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { ContestSubmissions } from "@/features/contests/ContestSubmissions";

export default function ContestSubmissionsPage() {
  const { id } = useParams();
  const contestId = Array.isArray(id) ? id[0] : id;
  return <PageContainer><h1 className="text-3xl font-bold text-foreground">My contest submissions</h1><div className="mt-8">{contestId ? <ContestSubmissions contestId={contestId} /> : null}</div></PageContainer>;
}
