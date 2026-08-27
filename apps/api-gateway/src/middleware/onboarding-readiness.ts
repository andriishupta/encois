import { OrganizationOnboardingStatus } from "@encois/contracts";
import type { MiddlewareHandler } from "hono";
import type { GatewayEnv } from "./aos.js";

export type OnboardingReadiness = {
  status: OrganizationOnboardingStatus;
  lastError?: string | null;
};

export type OnboardingReadinessReader = (
  organizationId: string,
) => Promise<OnboardingReadiness | null>;

function routePath(path: string): string {
  return path.replace(/^\/api\/v1(?=\/)/u, "") || "/";
}

function isOnboardingRoute(method: string, path: string): boolean {
  if (method === "GET" && path === "/organization") return true;
  if (method === "PATCH" && path === "/organization/onboarding") return true;
  if (method === "POST" && path === "/organization/onboarding/start")
    return true;
  if (method === "POST" && path === "/organization/onboarding/reset")
    return true;
  if (method === "GET" && path === "/sources") return true;
  if (method === "POST" && path === "/sources/uploads") return true;
  if (
    method === "POST" &&
    /^\/sources\/[^/]+\/revisions\/[^/]+\/ingest$/u.test(path)
  )
    return true;
  if (
    method === "GET" &&
    (path === "/workflows/templates" || path === "/workflows/blueprints")
  )
    return true;
  return (
    path.startsWith("/internal/coordinator/") ||
    path.startsWith("/internal/integrations/")
  );
}

function requiredMessage(readiness: OnboardingReadiness): string {
  switch (readiness.status) {
    case OrganizationOnboardingStatus.Pending:
      return "Organization onboarding must be completed before using this product surface.";
    case OrganizationOnboardingStatus.Initializing:
      return "Organization onboarding is still initializing. Product access will open when bootstrap completes.";
    case OrganizationOnboardingStatus.Failed:
      return readiness.lastError
        ? `Organization onboarding failed: ${readiness.lastError}`
        : "Organization onboarding failed. An organization administrator must retry setup.";
    case OrganizationOnboardingStatus.Ready:
      return "";
  }
}

export function onboardingReadinessMiddleware(
  read: OnboardingReadinessReader,
): MiddlewareHandler<GatewayEnv> {
  return async (context, next) => {
    const method = context.req.method.toUpperCase();
    const path = routePath(context.req.path);
    if (isOnboardingRoute(method, path)) {
      await next();
      return;
    }

    const principal = context.get("principal");
    const readiness = await read(principal.organizationId);
    if (!readiness) {
      return context.json(
        {
          error: {
            code: "ORGANIZATION_ONBOARDING_NOT_FOUND",
            message:
              "Organization onboarding state is missing. Apply the current control-plane migration or repair the organization record.",
            requestId: context.get("requestId"),
            traceId: context.get("traceId"),
          },
        },
        503,
      );
    }
    if (readiness.status !== OrganizationOnboardingStatus.Ready) {
      return context.json(
        {
          error: {
            code: "ORGANIZATION_ONBOARDING_REQUIRED",
            message: requiredMessage(readiness),
            onboardingStatus: readiness.status,
            requestId: context.get("requestId"),
            traceId: context.get("traceId"),
          },
        },
        409,
      );
    }

    await next();
  };
}
