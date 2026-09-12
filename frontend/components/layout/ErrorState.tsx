import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-destructive/30 bg-card px-6 py-12 text-center", className)}>
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle aria-hidden="true" className="size-5" />
      </div>
      <h2 className="font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? (
        <Button className="mt-5" variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
