interface ResizeHandleProps {
  leftPanelWidth: number;
  isResizing: boolean;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function ResizeHandle({
  leftPanelWidth,
  isResizing,
  onKeyDown,
  onPointerDown,
}: ResizeHandleProps) {
  return (
    <div
      aria-label="Resize problem and editor panels"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={leftPanelWidth}
      aria-valuemin={34}
      aria-valuemax={64}
      tabIndex={0}
      className={`hidden w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary md:block ${isResizing ? "bg-primary" : ""}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
