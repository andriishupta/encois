import type { Context, MiddlewareHandler } from "hono";

export type AosPrincipal = {
  actorId: string;
  /** Local users.id when the identity has been resolved to the control plane. */
  userId?: string;
  organizationId: string;
  scope: readonly string[];
};

export type AosAuthenticationResult =
  | { principal: AosPrincipal; status: "authenticated" }
  | { reason?: string; status: "unauthenticated" | "unconfigured" };

export type AosAuthenticator = (context: Context<GatewayEnv>) => Promise<AosAuthenticationResult>;

export type GatewayEnv = {
  Variables: {
    principal: AosPrincipal;
    requestId: string;
    traceId: string;
  };
};

export type AosOptions = {
  authenticate?: AosAuthenticator;
};

export function aosMiddleware(options: AosOptions = {}): MiddlewareHandler<GatewayEnv> {
  return async (context, next) => {
    const result = options.authenticate
      ? await options.authenticate(context)
      : { status: "unconfigured" as const };

    if (result.status === "authenticated") {
      context.set("principal", result.principal);
      await next();
      return;
    }

    const status = result.status === "unconfigured" ? 503 : 401;
    const code = result.status === "unconfigured" ? "AUTHENTICATION_UNAVAILABLE" : "UNAUTHENTICATED";
    const message =
      result.status === "unconfigured"
        ? "Authentication is not configured."
        : "Authentication is required.";

    return context.json(
      {
        error: {
          code,
          message,
          requestId: context.get("requestId"),
          traceId: context.get("traceId"),
        },
      },
      status,
    );
  };
}
