import type { MiddlewareHandler } from "hono";
import type { GatewayEnv } from "./aos.js";

export const requestLoggingMiddleware: MiddlewareHandler<GatewayEnv> = async (
  context,
  next,
) => {
  const startedAt = Date.now();
  await next();

  console.info(
    JSON.stringify({
      durationMs: Date.now() - startedAt,
      event: "http.request.completed",
      method: context.req.method,
      path: new URL(context.req.url).pathname,
      requestId: context.get("requestId"),
      traceId: context.get("traceId"),
      status: context.res.status,
    }),
  );
};
