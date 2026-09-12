interface ResizeHandleProps {
  isResizing: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function ResizeHandle({
  isResizing,
  onPointerDown,
}: ResizeHandleProps) {
  return (
    <div
      aria-label="Resize problem and editor panels"
      className={`hidden w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary md:block ${isResizing ? "bg-primary" : ""}`}
      onPointerDown={onPointerDown}
    />
  );
}
