import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EditorToolbar } from "@/features/workspace/EditorToolbar";
import { ResultDrawer } from "@/features/workspace/ResultDrawer";
import { StatementPane } from "@/features/workspace/StatementPane";
import { useResizablePanes } from "@/features/workspace/useResizablePanes";
import type { ProblemDetail, Submission } from "@/types/api";

const problem: ProblemDetail = {
  _id: "problem-1",
  questionNum: 1,
  title: "Two Sum",
  slug: "two-sum",
  difficulty: "Easy",
  tags: ["Array", "Hash Table"],
  description: "Find two numbers that add up to a target.",
  constraints: ["Two answers exist."],
  sampleTestCases: [{ input: "[2,7,11,15]", output: "[0,1]" }],
  starterCode: [{ language: "javascript", code: "function solve() {}" }],
};

const submission: Submission = {
  status: "completed",
  verdict: "Wrong Answer",
  passedTestCases: 1,
  totalTestCases: 2,
  maxRuntime: 4,
  failedTestCase: {
    input: "[]",
    expected: "1",
    received: "2",
  },
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("workspace components", () => {
  it("renders the statement content and read-only sections", () => {
    render(<StatementPane problem={problem} />);

    expect(screen.getByRole("heading", { name: /1\. Two Sum/ })).toBeInTheDocument();
    expect(screen.getByText(problem.description)).toBeInTheDocument();
    expect(screen.getByText("Array")).toBeInTheDocument();
    expect(screen.getByText("[2,7,11,15]")).toBeInTheDocument();
  });

  it("keeps toolbar controls explicit and forwards interactions", () => {
    const onLanguageChange = () => undefined;
    const onSubmit = () => undefined;
    render(
      <EditorToolbar
        language="javascript"
        problem={problem}
        submission={null}
        isSubmitting={false}
        onLanguageChange={onLanguageChange}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue(
      "javascript",
    );
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  });

  it("renders the existing empty and verdict result states", () => {
    const { rerender } = render(<ResultDrawer submission={null} />);
    expect(
      screen.getByText("Submit your solution to see the result."),
    ).toBeInTheDocument();

    rerender(<ResultDrawer submission={submission} />);
    expect(screen.getByText("Wrong Answer")).toBeInTheDocument();
    expect(screen.getByText("Failed Test Case")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

function ResizeProbe() {
  const { leftPanelWidth, isResizing, handlePointerDown } =
    useResizablePanes();
  return (
    <>
      <output data-testid="width">{leftPanelWidth}</output>
      <output data-testid="resizing">{String(isResizing)}</output>
      <div onPointerDown={handlePointerDown}>resize</div>
    </>
  );
}

describe("useResizablePanes", () => {
  it("initializes at the existing width and cleans up pointer listeners", async () => {
    const { unmount } = render(<ResizeProbe />);
    expect(screen.getByTestId("width")).toHaveTextContent("46");
    expect(screen.getByTestId("resizing")).toHaveTextContent("false");

    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: () => undefined,
    });
    fireEvent.pointerDown(screen.getByText("resize"), { pointerId: 1 });
    expect(screen.getByTestId("resizing")).toHaveTextContent("true");

    fireEvent.pointerMove(window, { clientX: window.innerWidth * 0.7 });
    await waitFor(() =>
      expect(screen.getByTestId("width")).toHaveTextContent("64"),
    );

    fireEvent.pointerUp(window);
    expect(screen.getByTestId("resizing")).toHaveTextContent("false");
    unmount();
  });
});
