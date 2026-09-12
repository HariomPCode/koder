import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthContext } from "@/context/AuthContext";
import { RequireAuth } from "@/components/auth/RequireAuth";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace }),
}));

function renderWithStatus(status: "authenticated" | "unauthenticated") {
  return render(
    <AuthContext.Provider
      value={{
        user: status === "authenticated" ? {
          _id: "user-1",
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.com",
          role: "user",
        } : null,
        loading: false,
        status,
        error: null,
        accessDenied: false,
        refreshUser: async () => true,
        logout: async () => {},
      }}
    >
      <RequireAuth>
        <div>protected content</div>
      </RequireAuth>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  replace.mockReset();
  document.body.innerHTML = "";
});

describe("RequireAuth", () => {
  it("redirects unauthenticated visitors and does not render protected content", async () => {
    renderWithStatus("unauthenticated");

    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin?next=%2Fdashboard"));
  });

  it("renders protected content for authenticated users", () => {
    renderWithStatus("authenticated");
    expect(screen.getByText("protected content")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
