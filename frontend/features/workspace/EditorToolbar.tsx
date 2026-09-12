import { Button } from "@/components/ui/button";
import type { ProblemDetail, Submission } from "@/types/api";

interface EditorToolbarProps {
  language: string;
  problem: ProblemDetail | null;
  submission: Submission | null;
  isSubmitting: boolean;
  onLanguageChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  onSubmit: () => void;
}

export function EditorToolbar({
  language,
  problem,
  submission,
  isSubmitting,
  onLanguageChange,
  onSubmit,
}: EditorToolbarProps) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 sm:px-5">
      <select
        aria-label="Language"
        value={language}
        onChange={onLanguageChange}
        className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 outline-none focus:border-primary"
      >
        <option value="javascript">JavaScript</option>
        <option value="java">Java</option>
        <option value="python">Python</option>
      </select>
      <Button
        type="button"
        variant="default"
        onClick={onSubmit}
        disabled={isSubmitting || !problem}
        className="min-w-24 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
      >
        {isSubmitting && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-950/30 border-t-emerald-950" />
        )}
        {isSubmitting ? "Submitting..." : submission ? "Submitted" : "Submit"}
      </Button>
    </div>
  );
}
