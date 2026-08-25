import type { MiddlewareHandler } from "hono";
import type { GatewayEnv } from "./aos.js";

type JsonRecord = Record<string, unknown>;

function hasOwn(value: JsonRecord, key: string): boolean {
  return Object.hasOwn(value, key);
}

function normalizeBody(
  body: unknown,
): { data: unknown; error: unknown } & JsonRecord {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as JsonRecord;
    if (hasOwn(record, "data") || hasOwn(record, "error")) {
      return {
        ...record,
        data: hasOwn(record, "data") ? (record.data ?? null) : null,
        error: hasOwn(record, "error") ? (record.error ?? null) : null,
      };
    }
  }

  return { data: body ?? null, error: null };
}

/**
 * Keeps every JSON response on the public HTTP boundary in the same shape.
 * Route handlers can remain focused on domain behavior while clients always
 * receive `{ data, error }`; list handlers may additionally return pagination.
 */
export const apiResponseEnvelopeMiddleware: MiddlewareHandler<
  GatewayEnv
> = async (context, next) => {
  await next();

  const response = context.res;
  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (response.status === 204 || !contentType?.includes("application/json")) {
    return;
  }

  const body = await response
    .clone()
    .json()
    .catch(() => undefined);
  if (body === undefined) return;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(normalizeBody(body)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
