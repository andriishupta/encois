import { AuthAccessStatus, type AuthStatusResponse } from "@encois/contracts";
import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/aos.js";
import type {
  IdentityAccessResolver,
  IdentityPlatformVerifier,
} from "./identity-platform.js";

export type AuthRouterOptions = {
  resolveAccess?: IdentityAccessResolver;
  verifyIdentity?: IdentityPlatformVerifier;
};

export function createAuthRouter(
  options: AuthRouterOptions = {},
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();

  router.get("/me", async (context) => {
    if (!options.verifyIdentity || !options.resolveAccess) {
      return context.json(
        {
          data: null,
          error: {
            code: "AUTHENTICATION_UNAVAILABLE",
            message: "Authentication is not configured.",
            requestId: context.get("requestId"),
            traceId: context.get("traceId"),
          },
        },
        503,
      );
    }

    const identityResult = await options.verifyIdentity(context);
    if (identityResult.status !== "authenticated") {
      const status = identityResult.status === "unconfigured" ? 503 : 401;
      return context.json(
        {
          data: null,
          error: {
            code:
              identityResult.status === "unconfigured"
                ? "AUTHENTICATION_UNAVAILABLE"
                : "UNAUTHENTICATED",
            message:
              identityResult.status === "unconfigured"
                ? "Authentication is not configured."
                : "Authentication is required.",
            requestId: context.get("requestId"),
            traceId: context.get("traceId"),
          },
        },
        status,
      );
    }

    const access = await options.resolveAccess(
      identityResult.identity,
      context,
    );
    if (access.status === "unavailable") {
      return context.json(
        {
          data: null,
          error: {
            code: "PERSISTENCE_UNAVAILABLE",
            message: "Access provisioning is not configured.",
            requestId: context.get("requestId"),
            traceId: context.get("traceId"),
          },
        },
        503,
      );
    }

    const response: AuthStatusResponse =
      access.status === "active"
        ? {
            status: AuthAccessStatus.Active,
            userId: access.principal.userId ?? access.principal.actorId,
            organizationId: access.principal.organizationId,
            permissions: access.principal.permissions ?? [],
          }
        : { status: AuthAccessStatus.Pending };

    return context.json({ data: response, error: null });
  });

  return router;
}
