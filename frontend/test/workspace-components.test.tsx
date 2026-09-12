import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorToolbar } from "@/features/workspace/EditorToolbar";
import { ResultDrawer } from "@/features/workspace/ResultDrawer";
import { ResizeHandle } from "@/features/workspace/ResizeHandle";
import { StatementPane } from "@/features/workspace/StatementPane";
import { useResizablePanes } from "@/features/workspace/useResizablePanes";
import { ApiError } from "@/lib/api-client";
import { getSubmissionErrorMessage } from "@/lib/api/submissions";
import * as submissionApi from "@/lib/api/submissions";
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
  vi.restoreAllMocks();
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

  it.each([
    ["created", "Created"],
    ["queued", "Queued"],
    ["running", "Running"],
  ] as const)("renders %s as %s while pending", (status, label) => {
    render(
      <ResultDrawer
        submission={{
          status,
          verdict: "",
        }}
      />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("renders Memory Limit Exceeded through the shared verdict presentation", () => {
    render(
      <ResultDrawer
        submission={{
          status: "completed",
          verdict: "Memory Limit Exceeded",
        }}
      />,
    );
    expect(screen.getByText("Memory Limit Exceeded")).toHaveClass(
      "text-orange-400",
    );
  });

  it("maps duplicate submissions to the idempotency message", () => {
    expect(
      getSubmissionErrorMessage(
        new ApiError(409, {
          message: "An identical submission is already being processed",
        }),
      ),
    ).toBe("An identical submission is already being processed");
    expect(getSubmissionErrorMessage(new Error("network"))).toBe(
      "Failed to submit solution",
    );
  });

  it("exposes an accessible resize separator", () => {
    const onKeyDown = vi.fn();
    render(
      <ResizeHandle
        leftPanelWidth={46}
        isResizing={false}
        onKeyDown={onKeyDown}
        onPointerDown={() => undefined}
      />,
    );
    const separator = screen.getByRole("separator");
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuenow", "46");
    expect(separator).toHaveAttribute("aria-valuemin", "34");
    expect(separator).toHaveAttribute("aria-valuemax", "64");
    expect(separator).toHaveAttribute("tabindex", "0");
  });
});

function ResizeProbe() {
  const {
    leftPanelWidth,
    isResizing,
    handlePointerDown,
    adjustLeftPanelWidth,
  } =
    useResizablePanes();
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") adjustLeftPanelWidth(-4);
    if (event.key === "ArrowRight") adjustLeftPanelWidth(4);
  };
  return (
    <>
      <output data-testid="width">{leftPanelWidth}</output>
      <output data-testid="resizing">{String(isResizing)}</output>
      <ResizeHandle
        leftPanelWidth={leftPanelWidth}
        isResizing={isResizing}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
      />
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

    const separator = screen.getByRole("separator");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(screen.getByTestId("width")).toHaveTextContent("50");
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(screen.getByTestId("width")).toHaveTextContent("46");

    fireEvent.pointerDown(separator, { pointerId: 1 });
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

describe("submission history", () => {
  it("loads and renders the current question submissions", async () => {
    vi.spyOn(submissionApi, "getQuestionSubmissions").mockResolvedValue({
      submissions: [
        {
          _id: "submission-1",
          status: "completed",
          verdict: "Accepted",
          language: "javascript",
          maxRuntime: 12,
          createdAt: "2026-09-12T10:00:00.000Z",
        },
      ],
    });

    render(<StatementPane problem={problem} />);
    fireEvent.click(screen.getByRole("tab", { name: "Submissions" }));

    await waitFor(() => expect(screen.getByText("Accepted")).toBeInTheDocument());
    expect(screen.getByText("Language: javascript")).toBeInTheDocument();
    expect(screen.getByText("Runtime: 12 ms")).toBeInTheDocument();
  });

  it("renders an empty state and an error state for submission history", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getQuestionSubmissions = vi
      .spyOn(submissionApi, "getQuestionSubmissions")
      .mockResolvedValueOnce({ message: "No submissions made for this problem" })
      .mockRejectedValueOnce(new Error("network"));

    const { rerender } = render(<StatementPane problem={problem} />);
    fireEvent.click(screen.getByRole("tab", { name: "Submissions" }));
    await waitFor(() =>
      expect(screen.getByText("No submissions yet")).toBeInTheDocument(),
    );

    rerender(<StatementPane problem={{ ...problem, _id: "problem-2" }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Submissions" }));
    await waitFor(() =>
      expect(screen.getByText("Unable to load submissions")).toBeInTheDocument(),
    );
    expect(getQuestionSubmissions).toHaveBeenCalledWith("problem-2");
  });
});
