import type { ApiErrorBody } from "@/types/api";

export const AUTH_EXPIRED_EVENT = "koder:auth-expired";
export const AUTH_FORBIDDEN_EVENT = "koder:auth-forbidden";

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

function getApiBaseUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_BACKEND_URL is not configured");
  }
  return baseUrl.replace(/\/+$/, "");
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (response.status === 204 || !contentType.includes("application/json")) {
    return null;
  }
  return (await response.json()) as unknown;
}

async function request<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    credentials: options.credentials ?? "include",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await parseResponse(response);

  if (!response.ok) {
    if (
      response.status === 401 &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }
    if (response.status === 403 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(AUTH_FORBIDDEN_EVENT));
    }
    const errorBody =
      body && typeof body === "object" ? (body as ApiErrorBody) : null;
    throw new ApiError(response.status, errorBody);
  }

  return body as T;
}

export const api = {
  get<T>(path: string, options?: Omit<ApiRequestOptions, "method" | "body">) {
    return request<T>(path, { ...options, method: "GET" });
  },
  post<T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, "method" | "body">) {
    return request<T>(path, { ...options, method: "POST", body });
  },
  put<T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, "method" | "body">) {
    return request<T>(path, { ...options, method: "PUT", body });
  },
  patch<T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, "method" | "body">) {
    return request<T>(path, { ...options, method: "PATCH", body });
  },
  delete<T>(path: string, options?: Omit<ApiRequestOptions, "method" | "body">) {
    return request<T>(path, { ...options, method: "DELETE" });
  },
};
