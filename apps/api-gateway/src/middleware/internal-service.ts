import type { MiddlewareHandler } from "hono";
import type { GatewayEnv } from "./aos.js";

export function internalServiceOnly(
  serviceToken: string | undefined,
): MiddlewareHandler<GatewayEnv> {
  return async (context, next) => {
    if (!serviceToken) {
      return context.json(
        {
          error: {
            code: "INTERNAL_SERVICE_UNAVAILABLE",
            message: "Internal service authentication is not configured.",
          },
        },
        503,
      );
    }
    if (context.req.header("X-Encois-Service-Token") !== serviceToken) {
      return context.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "A valid internal service credential is required.",
          },
        },
        401,
      );
    }
    await next();
  };
}
