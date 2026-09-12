"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const TabsContext = createContext<{ value: string; setValue: (value: string) => void } | null>(null);

export function Tabs({ defaultValue, children, className }: { defaultValue: string; children: ReactNode; className?: string }) {
  const [value, setValue] = useState(defaultValue);
  return <TabsContext.Provider value={{ value, setValue }}><div className={className}>{children}</div></TabsContext.Provider>;
}
export function TabsList({ className, children }: { className?: string; children: ReactNode }) {
  return <div role="tablist" className={cn("inline-flex items-center rounded-md bg-muted p-1", className)}>{children}</div>;
}
export function TabsTrigger({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const context = useContext(TabsContext);
  if (!context) throw new Error("TabsTrigger must be used within Tabs");
  return <button type="button" role="tab" aria-selected={context.value === value} onClick={() => context.setValue(value)} className={cn("rounded-sm px-3 py-1.5 text-sm text-muted-foreground aria-selected:bg-background aria-selected:text-foreground", className)}>{children}</button>;
}
export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const context = useContext(TabsContext);
  if (!context || context.value !== value) return null;
  return <div role="tabpanel" className={className}>{children}</div>;
}
