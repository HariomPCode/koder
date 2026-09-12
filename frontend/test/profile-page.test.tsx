import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileContent } from "@/features/profile/ProfileContent";

const { get } = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { ...actual.api, get },
  };
});

const profile = {
  _id: "user-1",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  rating: 1450,
  highestRating: 1600,
  contestsParticipated: 8,
  role: "user" as const,
};

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("profile page content", () => {
  it("renders the authenticated user's profile data", async () => {
    get.mockResolvedValue({ user: profile });

    render(<ProfileContent />);

    await waitFor(() =>
      expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0),
    );
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("1450")).toBeInTheDocument();
    expect(screen.getByText("1600")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getAllByText("user").length).toBeGreaterThan(0);
    expect(get).toHaveBeenCalledWith("/api/v1/user");
  });

  it("shows a loading state while the profile request is pending", () => {
    get.mockReturnValue(new Promise(() => {}));

    const { container } = render(<ProfileContent />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows a recoverable error state when the profile request fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    get.mockRejectedValue(new Error("Profile unavailable"));

    render(<ProfileContent />);

    await waitFor(() =>
      expect(screen.getByText("Unable to load profile")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Unable to load your profile. Please try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("renders optional profile values honestly when they are absent", async () => {
    get.mockResolvedValue({
      user: {
        ...profile,
        rating: undefined,
        highestRating: undefined,
        contestsParticipated: undefined,
      },
    });

    render(<ProfileContent />);

    await waitFor(() =>
      expect(screen.getAllByText("Not available")).toHaveLength(3),
    );
  });
});
