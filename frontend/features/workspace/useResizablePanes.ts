"use client";

import { useEffect, useState } from "react";

const INITIAL_LEFT_PANEL_WIDTH = 46;
export const MIN_LEFT_PANEL_WIDTH = 34;
export const MAX_LEFT_PANEL_WIDTH = 64;
export const RESIZE_STEP = 4;

export function useResizablePanes() {
  const [leftPanelWidth, setLeftPanelWidth] = useState(
    INITIAL_LEFT_PANEL_WIDTH,
  );
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;

    const resize = (event: PointerEvent) =>
      setLeftPanelWidth(
        Math.min(
          MAX_LEFT_PANEL_WIDTH,
          Math.max(
            MIN_LEFT_PANEL_WIDTH,
            (event.clientX / window.innerWidth) * 100,
          ),
        ),
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

  const adjustLeftPanelWidth = (delta: number) => {
    setLeftPanelWidth((current) =>
      Math.min(
        MAX_LEFT_PANEL_WIDTH,
        Math.max(MIN_LEFT_PANEL_WIDTH, current + delta),
      ),
    );
  };

  return {
    leftPanelWidth,
    isResizing,
    handlePointerDown,
    adjustLeftPanelWidth,
  };
}
