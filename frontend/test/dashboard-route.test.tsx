import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Dashboard from "@/app/dashboard/page";

const { get } = vi.hoisted(() => ({
  get: vi.fn(),
}));
const { replace, authState } = vi.hoisted(() => ({
  replace: vi.fn(),
  authState: {
    status: "authenticated" as
      | "authenticated"
      | "unauthenticated"
      | "checking"
      | "error",
    user: {
      _id: "user-1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      role: "user" as const,
    } as {
      _id: string;
      firstName: string;
      lastName: string;
      email: string;
      role: "user" | "admin";
    } | null,
  },
}));

vi.mock("@/lib/api-client", () => ({
  api: { get },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    ...authState,
    loading: authState.status === "checking",
    error: null,
    accessDenied: false,
    refreshUser: async () => true,
    logout: async () => {},
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace }),
}));

afterEach(() => {
  vi.clearAllMocks();
  authState.status = "authenticated";
  authState.user = {
    _id: "user-1",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    role: "user",
  };
  document.body.innerHTML = "";
});

describe("dashboard route", () => {
  it("renders the profile link in the authenticated dashboard header", async () => {
    get.mockResolvedValue({
      totalSubmissions: 0,
      solvedCount: 0,
      attemptedCount: 0,
      attemptedButUnsolved: 0,
      acceptedSubmissions: 0,
      acceptanceRate: 0,
      solvedEasyQuestions: 0,
      solvedMediumQuestions: 0,
      solvedHardQuestions: 0,
      availableByDifficulty: { Easy: 0, Medium: 0, Hard: 0 },
      recentSubmissions: [],
      recentlySolved: [],
      activity: {
        currentStreak: 0,
        longestStreak: 0,
        lastActive: null,
        weeklySolved: 0,
        weeklyAttempted: 0,
      },
      recommendation: null,
      solvedQuestions: [],
    });

    render(<Dashboard />);

    const profileLink = await screen.findByRole("link", { name: "View profile" });
    expect(profileLink).toHaveAttribute("href", "/profile");
    await waitFor(() => expect(screen.getByText("Welcome back, Ada")).toBeInTheDocument());
  });

  it("redirects unauthenticated dashboard visitors through the existing guard", async () => {
    authState.status = "unauthenticated";
    authState.user = null;

    render(<Dashboard />);

    expect(screen.queryByText("Welcome back, Ada")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/signin?next=%2Fdashboard"),
    );
  });
});
