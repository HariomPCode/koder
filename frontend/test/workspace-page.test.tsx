import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SolveProblem from "@/app/problems/[slug]/page";
import type { ProblemDetail } from "@/types/api";

const problem: ProblemDetail = {
  _id: "problem-1",
  questionNum: 1,
  title: "Two Sum",
  slug: "two-sum",
  difficulty: "Easy",
  tags: [],
  description: "Find two numbers.",
  constraints: [],
  sampleTestCases: [],
  starterCode: [{ language: "javascript", code: "function solve() {}" }],
};

const { get } = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@monaco-editor/react", () => ({
  default: () => <div aria-label="Code editor" />,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "two-sum" }),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    get,
    post: vi.fn(),
  },
}));

describe("workspace page accessibility wiring", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("provides a functional skip link to the editor workspace", async () => {
    get.mockResolvedValue({ question: problem });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });

    render(<SolveProblem />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /1\. Two Sum/ })).toBeInTheDocument(),
    );
    const skipLink = screen.getByRole("link", { name: "Skip to editor" });
    const target = document.querySelector(skipLink.getAttribute("href") ?? "");

    expect(skipLink).toHaveAttribute("href", "#editor-workspace");
    expect(target).toHaveAttribute("id", "editor-workspace");
    expect(target).toHaveAttribute("tabindex", "-1");
  });
});
