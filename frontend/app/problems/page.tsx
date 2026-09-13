import { ErrorState } from "@/components/layout/ErrorState";
import { PageContainer } from "@/components/layout/PageContainer";
import { ProblemsClient } from "@/features/problems/ProblemsClient";
import { getInitialQuestions } from "@/lib/server-api";

export default async function ProblemsPage() {
  let data;
  try {
    data = await getInitialQuestions();
  } catch (error) {
    return (
      <PageContainer>
        <ErrorState
          title="Unable to load problems"
          description={
            error instanceof Error ? error.message : "Please try again."
          }
        />
      </PageContainer>
    );
  }
  return <ProblemsClient initialProblems={data.questions ?? []} />;
}
