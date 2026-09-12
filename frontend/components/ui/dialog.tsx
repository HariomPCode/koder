"use client";

import { useEffect, type ReactNode } from "react";

export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);
  if (!open) return null;
  return <div role="presentation" className="fixed inset-0 z-50 bg-black/60" onMouseDown={() => onOpenChange(false)}>{children}</div>;
}
export function DialogContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div role="dialog" aria-modal="true" className={`fixed inset-y-0 right-0 z-50 w-[min(22rem,90vw)] border-l border-border bg-background p-6 shadow-xl ${className ?? ""}`} onMouseDown={(event) => event.stopPropagation()}>{children}</div>;
}
