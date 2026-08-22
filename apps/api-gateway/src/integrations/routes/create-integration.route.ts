import type { Handler } from "hono";
import { isJsonObject } from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import { createIntegrationForPrincipal, type IntegrationCreate } from "../services/integrations.service.js";

function parseCreate(value: unknown): IntegrationCreate | null {
  if (!isJsonObject(value) || typeof value.displayName !== "string" || typeof value.provider !== "string" || typeof value.organizationUnitId !== "string") return null;
  if (value.grantedScopes !== undefined && (!Array.isArray(value.grantedScopes) || value.grantedScopes.some((scope) => typeof scope !== "string"))) return null;
  return {
    displayName: value.displayName,
    provider: value.provider,
    organizationUnitId: value.organizationUnitId,
    ...(Array.isArray(value.grantedScopes) ? { grantedScopes: value.grantedScopes as string[] } : {}),
  };
}

export const createIntegrationRoute: Handler<GatewayEnv> = async (context) => {
  const request = parseCreate(await context.req.json().catch(() => null));
  if (!request) return context.json({ error: { code: "INVALID_REQUEST", message: "displayName, provider, and organizationUnitId are required." } }, 400);
  try {
    return context.json({ data: await createIntegrationForPrincipal(context.get("principal"), request) }, 201);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTEGRATION_CREATE_FAILED";
    const status = code === "FORBIDDEN" ? 403 : code === "SCOPE_DENIED" ? 403 : code === "PERSISTENCE_UNAVAILABLE" ? 503 : code === "IDENTITY_NOT_RESOLVED" ? 403 : 422;
    return context.json({ error: { code, message: code === "PERSISTENCE_UNAVAILABLE" ? "Database access is not configured." : "The integration could not be registered." } }, status);
  }
};
