import { ErrorState } from "@/components/layout/ErrorState";
import SolveProblemClient from "@/features/workspace/SolveProblemClient";
import { getInitialQuestion } from "@/lib/server-api";

export default async function ProblemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let data;
  try {
    data = await getInitialQuestion(slug);
  } catch (error) {
    return (
      <ErrorState
        title="Unable to load problem"
        description={
          error instanceof Error ? error.message : "Please try again."
        }
      />
    );
  }
  if (!data.question)
    return <ErrorState title="Problem not found" description="This problem is not available." />;
  return <SolveProblemClient problem={data.question} slug={slug} />;
}
