import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function PageContainer({
  className,
  ...props
}: ComponentProps<"main">) {
  return (
    <main
      className={cn("mx-auto min-h-[calc(100vh-4rem)] w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8", className)}
      {...props}
    />
  );
}
