import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/layout/ErrorState";
import { Button } from "@/components/ui/button";
import { DIFFICULTIES, DIFFICULTY_PRESENTATION } from "@/lib/constants/difficulty";
import { VERDICTS, VERDICT_PRESENTATION } from "@/lib/constants/verdict";

describe("phase 1 design foundations", () => {
  it("covers every supported difficulty and verdict presentation", () => {
    expect(Object.keys(DIFFICULTY_PRESENTATION).sort()).toEqual([...DIFFICULTIES].sort());
    expect(Object.keys(VERDICT_PRESENTATION).sort()).toEqual([...VERDICTS, "pending"].sort());
  });

  it("renders accessible shared state components and button states", () => {
    const retry = () => undefined;
    render(
      <>
        <EmptyState title="Nothing here" action={{ label: "Clear", onClick: retry }} />
        <ErrorState description="Try again" action={{ label: "Retry", onClick: retry }} />
        <Button disabled>Submit</Button>
      </>,
    );
    expect(screen.getByRole("heading", { name: "Nothing here" })).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });
});
