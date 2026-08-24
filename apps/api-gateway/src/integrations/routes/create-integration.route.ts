import { isJsonObject } from "@encois/contracts";
import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  createIntegrationForPrincipal,
  type IntegrationCreate,
} from "../services/integrations.service.js";

function parseCreate(value: unknown): IntegrationCreate | null {
  if (
    !isJsonObject(value) ||
    typeof value.displayName !== "string" ||
    typeof value.provider !== "string"
  )
    return null;
  if (
    value.organizationUnitId !== undefined &&
    typeof value.organizationUnitId !== "string"
  )
    return null;
  if (
    value.grantedScopes !== undefined &&
    (!Array.isArray(value.grantedScopes) ||
      value.grantedScopes.some((scope) => typeof scope !== "string"))
  )
    return null;
  return {
    displayName: value.displayName,
    provider: value.provider,
    ...(typeof value.organizationUnitId === "string"
      ? { organizationUnitId: value.organizationUnitId }
      : {}),
    ...(Array.isArray(value.grantedScopes)
      ? { grantedScopes: value.grantedScopes as string[] }
      : {}),
  };
}

export const createIntegrationRoute: Handler<GatewayEnv> = async (context) => {
  const request = parseCreate(await context.req.json().catch(() => null));
  if (!request)
    return context.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "displayName and provider are required.",
        },
      },
      400,
    );
  try {
    return context.json(
      {
        data: await createIntegrationForPrincipal(
          context.get("principal"),
          request,
        ),
      },
      201,
    );
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "INTEGRATION_CREATE_FAILED";
    const status = [
      "FORBIDDEN",
      "SCOPE_DENIED",
      "INTEGRATION_ORGANIZATION_SCOPED",
      "IDENTITY_NOT_RESOLVED",
    ].includes(code)
      ? 403
      : code === "PERSISTENCE_UNAVAILABLE"
        ? 503
        : 422;
    const message =
      code === "PERSISTENCE_UNAVAILABLE"
        ? "Database access is not configured."
        : code === "INTEGRATION_ORGANIZATION_SCOPED"
          ? "Integrations are organization-scoped. Create a Source for an organization unit."
          : "The integration could not be registered.";
    return context.json({ error: { code, message } }, status);
  }
};
