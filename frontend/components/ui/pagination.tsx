import type { ButtonHTMLAttributes } from "react";

import { Button } from "@/components/ui/button";

export function Pagination({ children }: { children: React.ReactNode }) {
  return <nav aria-label="Pagination" className="flex items-center justify-center">{children}</nav>;
}
export function PaginationContent({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}
export function PaginationItem({ children }: { children: React.ReactNode }) {
  return <span>{children}</span>;
}
export function PaginationLink({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button variant="outline" size="sm" className={className} {...props} />;
}
