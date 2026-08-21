import type { MiddlewareHandler } from "hono";
import type { GatewayEnv } from "./aos.js";

const TRACEPARENT_PATTERN = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/i;
const SAFE_TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function traceIdFromHeaders(traceparent: string | undefined, explicit: string | undefined): string | undefined {
  const parentMatch = traceparent?.trim().match(TRACEPARENT_PATTERN);
  if (parentMatch?.[1] && !/^0+$/.test(parentMatch[1])) return parentMatch[1].toLowerCase();
  const candidate = explicit?.trim();
  return candidate && SAFE_TRACE_ID_PATTERN.test(candidate) ? candidate : undefined;
}

export const traceContextMiddleware: MiddlewareHandler<GatewayEnv> = async (context, next) => {
  const traceId =
    traceIdFromHeaders(context.req.header("traceparent"), context.req.header("x-trace-id")) ??
    context.get("requestId");
  context.set("traceId", traceId);
  context.header("X-Trace-ID", traceId);
  await next();
};
