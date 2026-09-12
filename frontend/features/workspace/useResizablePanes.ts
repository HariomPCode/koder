"use client";

import { useEffect, useState } from "react";

const INITIAL_LEFT_PANEL_WIDTH = 46;

export function useResizablePanes() {
  const [leftPanelWidth, setLeftPanelWidth] = useState(
    INITIAL_LEFT_PANEL_WIDTH,
  );
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;

    const resize = (event: PointerEvent) =>
      setLeftPanelWidth(
        Math.min(64, Math.max(34, (event.clientX / window.innerWidth) * 100)),
      );
    const stop = () => setIsResizing(false);

    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);

    return () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
    };
  }, [isResizing]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  };

  return {
    leftPanelWidth,
    isResizing,
    handlePointerDown,
  };
}
