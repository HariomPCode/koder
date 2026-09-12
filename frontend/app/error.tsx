"use client";

import { ErrorState } from "@/components/layout/ErrorState";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState title="Application error" description="Something unexpected happened. Please try again." action={{ label: "Try again", onClick: reset }} className="mx-auto mt-12 max-w-xl" />;
}
