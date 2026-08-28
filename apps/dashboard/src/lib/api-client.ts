import { isJsonObject } from "@encois/contracts/browser";
import { clearAuthSession, getAuthSessionToken } from "@/lib/auth";

const environment =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
    .env ?? {};

export const apiBaseUrl = (environment.VITE_API_BASE_URL ?? "/api/v1").replace(
  /\/$/u,
  "",
);

export type ApiEnvelope<T> = {
  data: T | null;
  error: {
    code?: string;
    message?: string;
    requestId?: string;
    traceId?: string;
  } | null;
  pagination?: {
    limit?: unknown;
    offset?: unknown;
    total?: unknown;
    hasMore?: unknown;
  };
};

export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    traceId?: string;
  };
};

export type ApiError = Error & {
  name: "ApiError";
  status: number;
  code?: string;
  requestId?: string;
  traceId?: string;
};

export type ListQueryInput = {
  query?: string;
  status?: string;
  sort?: "updated-desc" | "updated-asc" | "name-asc" | "status";
  limit?: number;
  offset?: number;
};

export type ListPage<T> = {
  items: readonly T[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
};

export const DEFAULT_LIST_LIMIT = 10;

export function createApiError(
  status: number,
  message: string,
  code?: string,
  diagnostics?: {
    requestId?: string | undefined;
    traceId?: string | undefined;
  },
): ApiError {
  const error = new Error(message) as ApiError;
  error.name = "ApiError";
  error.status = status;
  if (code) error.code = code;
  if (diagnostics?.requestId) error.requestId = diagnostics.requestId;
  if (diagnostics?.traceId) error.traceId = diagnostics.traceId;
  return error;
}

export function isApiError(value: unknown): value is ApiError {
  return (
    value instanceof Error &&
    value.name === "ApiError" &&
    "status" in value &&
    typeof value.status === "number"
  );
}

export function errorPayload(value: unknown): ApiErrorPayload | null {
  if (!isJsonObject(value) || !isJsonObject(value.error)) return null;
  return {
    error: {
      ...(typeof value.error.code === "string"
        ? { code: value.error.code }
        : {}),
      ...(typeof value.error.message === "string"
        ? { message: value.error.message }
        : {}),
      ...(typeof value.error.requestId === "string"
        ? { requestId: value.error.requestId }
        : {}),
      ...(typeof value.error.traceId === "string"
        ? { traceId: value.error.traceId }
        : {}),
    },
  };
}

export function parseList<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
  name: string,
): readonly T[] {
  if (!Array.isArray(value) || !value.every(guard))
    throw createApiError(
      200,
      `The service returned an invalid ${name} response.`,
      "INVALID_RESPONSE",
    );
  return value;
}

export function parseListPage<T>(
  envelope: ApiEnvelope<unknown>,
  guard: (item: unknown) => item is T,
  name: string,
): ListPage<T> {
  const data = envelope.data;
  if (!Array.isArray(data) || !data.every(guard)) {
    throw createApiError(
      200,
      `The service returned an invalid ${name} response.`,
      "INVALID_RESPONSE",
    );
  }
  const pagination = isJsonObject(envelope.pagination)
    ? envelope.pagination
    : {};
  const limit =
    typeof pagination.limit === "number" ? pagination.limit : data.length;
  const offset = typeof pagination.offset === "number" ? pagination.offset : 0;
  const total =
    typeof pagination.total === "number" ? pagination.total : data.length;
  const hasMore =
    typeof pagination.hasMore === "boolean"
      ? pagination.hasMore
      : data.length === limit;
  return { items: data, pagination: { limit, offset, total, hasMore } };
}

export async function getSafeAuthSessionToken(forceRefresh = false) {
  try {
    return await getAuthSessionToken(forceRefresh);
  } catch {
    return null;
  }
}

export async function requestEnvelope<T>(
  path: string,
  init?: RequestInit,
  requiresAuth = true,
): Promise<ApiEnvelope<T>> {
  let session = requiresAuth ? await getSafeAuthSessionToken() : null;
  if (requiresAuth && !session) {
    clearAuthSession();
    throw createApiError(401, "Authentication is required.", "UNAUTHENTICATED");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    if (typeof init?.body === "string")
      headers.set("Content-Type", "application/json");
    if (session) {
      headers.set("Authorization", `Bearer ${session.accessToken}`);
      if (session.organizationId)
        headers.set("X-Organization-ID", session.organizationId);
    }

    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
    } catch {
      throw createApiError(
        0,
        "The workspace could not be reached.",
        "API_UNAVAILABLE",
      );
    }

    const body: unknown = await response.json().catch(() => null);
    if (response.status === 401 && requiresAuth && attempt === 0) {
      session = await getSafeAuthSessionToken(true);
      if (session) continue;
    }

    if (!response.ok) {
      const payload = errorPayload(body);
      if (response.status === 401) clearAuthSession();
      throw createApiError(
        response.status,
        payload?.error?.message ?? `API request failed (${response.status})`,
        payload?.error?.code,
        {
          requestId: payload?.error?.requestId,
          traceId: payload?.error?.traceId,
        },
      );
    }

    if (!isJsonObject(body) || !("data" in body)) {
      throw createApiError(
        response.status,
        "The service returned an invalid response envelope.",
        "INVALID_RESPONSE",
      );
    }
    const envelope = {
      ...body,
      error: "error" in body ? body.error : null,
    } as { data: unknown; error: unknown; pagination?: unknown };
    if (envelope.error !== null && !isJsonObject(envelope.error)) {
      throw createApiError(
        response.status,
        "The service returned an invalid response error.",
        "INVALID_RESPONSE",
      );
    }
    if (envelope.error) {
      const error = envelope.error;
      throw createApiError(
        response.status,
        typeof error.message === "string"
          ? error.message
          : "The service returned an API error.",
        typeof error.code === "string" ? error.code : undefined,
        {
          requestId:
            typeof error.requestId === "string" ? error.requestId : undefined,
          traceId:
            typeof error.traceId === "string" ? error.traceId : undefined,
        },
      );
    }
    return envelope as ApiEnvelope<T>;
  }

  clearAuthSession();
  throw createApiError(401, "Authentication is required.", "UNAUTHENTICATED");
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  requiresAuth = true,
): Promise<T> {
  const envelope = await requestEnvelope<T>(path, init, requiresAuth);
  if (envelope.data === null) {
    throw createApiError(
      200,
      "The service returned an empty response.",
      "INVALID_RESPONSE",
    );
  }
  return envelope.data;
}

export function listQuery(input: ListQueryInput): string {
  const params = new URLSearchParams();
  if (input.query?.trim()) params.set("q", input.query.trim());
  if (input.status && input.status !== "all")
    params.set("status", input.status);
  if (input.sort) params.set("sort", input.sort);
  if (input.limit !== undefined)
    params.set(
      "limit",
      String(Math.max(1, Math.min(Math.trunc(input.limit), 100))),
    );
  if (input.offset !== undefined)
    params.set("offset", String(Math.max(0, Math.trunc(input.offset))));
  return params.size ? `?${params.toString()}` : "";
}

export function requestList<T>(
  path: string,
  guard: (item: unknown) => item is T,
  name: string,
): Promise<ListPage<T>> {
  return requestEnvelope<unknown>(path).then((envelope) =>
    parseListPage(envelope, guard, name),
  );
}
