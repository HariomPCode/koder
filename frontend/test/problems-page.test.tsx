import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Problems from "@/app/problems/page";
import { api } from "@/lib/api-client";

let currentUrl = "/problems?page=1&limit=20";
const push = vi.fn((url: string) => {
  currentUrl = url;
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/problems",
  useRouter: () => ({ push }),
  useSearchParams: () =>
    new URLSearchParams(currentUrl.split("?")[1] ?? ""),
}));

const makeProblem = (questionNum: number, difficulty: "Easy" | "Medium" | "Hard") => ({
  _id: String(questionNum),
  questionNum,
  title: `Problem ${questionNum}`,
  slug: `problem-${questionNum}`,
  difficulty,
  tags: ["arrays"],
});

afterEach(() => {
  currentUrl = "/problems?page=1&limit=20";
  push.mockClear();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("problem discovery pagination and filters", () => {
  it("requests page 1, navigates to page 2, and preserves the selected limit", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async (path: string) => {
      const params = new URLSearchParams(path.split("?")[1]);
      const page = Number(params.get("page"));
      const limit = Number(params.get("limit"));
      return {
        message: "ok",
        questions: Array.from({ length: limit }, (_, index) =>
          makeProblem(page * limit + index, "Easy"),
        ),
      };
    });

    const view = render(<Problems />);
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith("/api/v1/questions?page=1&limit=20"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(push).toHaveBeenCalledWith("/problems?page=2&limit=20");

    view.rerender(<Problems />);
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith("/api/v1/questions?page=2&limit=20"),
    );
    expect(screen.getByText("Page 2")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(push).toHaveBeenLastCalledWith("/problems?page=1&limit=20");
  });

  it("caps filtering requests at 100 and resets to the first page", async () => {
    currentUrl = "/problems?page=4&limit=20&search=hard";
    const get = vi.spyOn(api, "get").mockResolvedValue({
      message: "ok",
      questions: [makeProblem(1, "Easy"), makeProblem(2, "Hard")],
    });

    const view = render(<Problems />);
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/problems?page=1&limit=100&search=hard"),
    );

    currentUrl = "/problems?page=1&limit=100&search=hard";
    view.rerender(<Problems />);
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith("/api/v1/questions?page=1&limit=100"),
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search problems" }), {
      target: { value: "hard" },
    });
    expect(push).toHaveBeenCalledWith("/problems?page=1&limit=100&search=hard");
  });

  it("disables Next when the backend returns fewer items than the requested limit", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      message: "ok",
      questions: [makeProblem(1, "Easy")],
    });

    render(<Problems />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled(),
    );
  });
});
