import { afterEach, describe, expect, it, vi } from "vitest";
import { api, AUTH_EXPIRED_EVENT } from "@/lib/api-client";

describe("api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serializes JSON requests, includes cookies, and returns typed JSON", async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:5000/";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await expect(api.post<{ message: string }>("/api/v1/auth/signin", {
      email: "user@example.com",
      password: "secret",
    })).resolves.toEqual({ message: "ok" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5000/api/v1/auth/signin",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ email: "user@example.com", password: "secret" }),
      }),
    );
  });

  it("surfaces backend error messages and status codes", async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:5000";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthenticated User" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(api.get("/api/v1/user")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "Unauthenticated User",
    });
  });

  it("keeps scoped 403 responses local without dispatching a global auth event", async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:5000";
    const forbiddenEvent = vi.fn();
    window.addEventListener("koder:auth-forbidden", forbiddenEvent);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ message: "You must register before viewing contest problems" }),
        {
          status: 403,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(api.get("/api/v1/contests/contest-1/problems")).rejects.toMatchObject({
      status: 403,
      message: "You must register before viewing contest problems",
    });
    expect(forbiddenEvent).not.toHaveBeenCalled();
    expect(AUTH_EXPIRED_EVENT).toBe("koder:auth-expired");
    window.removeEventListener("koder:auth-forbidden", forbiddenEvent);
  });
});
