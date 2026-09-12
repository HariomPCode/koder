import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";

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
});
