import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/context/AuthContext";
import { ApiError, api } from "@/lib/api-client";
import type { User } from "@/types/api";
import { useAuth } from "@/hooks/useAuth";

const user: User = {
  _id: "user-1",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  role: "user",
  rating: 1200,
};

function Probe() {
  const { status, user: currentUser, logout } = useAuth();
  return (
    <>
      <output data-testid="status">{status}</output>
      <output data-testid="user">{currentUser?.email ?? "none"}</output>
      <button onClick={() => void logout()}>logout</button>
    </>
  );
}

function renderAuth() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("AuthProvider", () => {
  it("exposes checking before resolving an authenticated session", async () => {
    let resolveRequest!: (value: { user: User }) => void;
    vi.spyOn(api, "get").mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    renderAuth();
    expect(screen.getByTestId("status")).toHaveTextContent("checking");

    await act(async () => resolveRequest({ user }));
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );
    expect(screen.getByTestId("user")).toHaveTextContent(user.email);
  });

  it("treats an unauthorized current-user response as unauthenticated", async () => {
    vi.spyOn(api, "get").mockRejectedValue(
      new ApiError(401, { message: "Unauthenticated User" }),
    );

    renderAuth();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"),
    );
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("clears authenticated state immediately on logout", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ user });
    vi.spyOn(api, "post").mockResolvedValue({ message: "signed out" });

    renderAuth();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );

    await act(async () => {
      screen.getByRole("button", { name: "logout" }).click();
    });
    expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated");
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });
});
