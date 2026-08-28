import { IntegrationType, isJsonObject } from "@encois/contracts";
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
    value.grantedScopes !== undefined &&
    (!Array.isArray(value.grantedScopes) ||
      value.grantedScopes.some((scope) => typeof scope !== "string"))
  )
    return null;
  if (
    value.type !== undefined &&
    (typeof value.type !== "string" ||
      !Object.values(IntegrationType).includes(value.type as IntegrationType))
  )
    return null;
  return {
    displayName: value.displayName,
    provider: value.provider,
    ...(Array.isArray(value.grantedScopes)
      ? { grantedScopes: value.grantedScopes as string[] }
      : {}),
    ...(typeof value.type === "string"
      ? { type: value.type as IntegrationType }
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
      "IDENTITY_NOT_RESOLVED",
    ].includes(code)
      ? 403
      : code === "PERSISTENCE_UNAVAILABLE"
        ? 503
        : 422;
    const message =
      code === "PERSISTENCE_UNAVAILABLE"
        ? "Database access is not configured."
        : "The integration could not be registered.";
    return context.json({ error: { code, message } }, status);
  }
};
