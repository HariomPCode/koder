"use client";

import { EmptyState } from "@/components/layout/EmptyState";

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you requested does not exist."
      action={{ label: "Return home", onClick: () => { window.location.href = "/"; } }}
      className="mx-auto mt-12 max-w-xl"
    />
  );
}
