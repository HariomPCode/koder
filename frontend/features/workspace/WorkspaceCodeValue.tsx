export function WorkspaceCodeValue({ children }: { children?: string }) {
  return (
    <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5 text-muted-foreground">
      {children || "—"}
    </pre>
  );
}
