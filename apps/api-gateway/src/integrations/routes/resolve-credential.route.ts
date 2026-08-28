import { isJsonObject } from "@encois/contracts";
import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import { resolveIntegrationCredentialForService } from "../services/integrations.service.js";

function parseRequest(value: unknown): {
  provider: string;
  capabilities: readonly string[];
  integrationId?: string;
} | null {
  if (
    !isJsonObject(value) ||
    typeof value.provider !== "string" ||
    !Array.isArray(value.capabilities)
  )
    return null;
  if (!value.capabilities.every((capability) => typeof capability === "string"))
    return null;
  return {
    provider: value.provider,
    capabilities: value.capabilities,
    ...(typeof value.integrationId === "string" && value.integrationId.trim()
      ? { integrationId: value.integrationId.trim() }
      : {}),
  };
}

export const resolveIntegrationCredentialRoute: Handler<GatewayEnv> = async (
  context,
) => {
  const request = parseRequest(await context.req.json().catch(() => null));
  if (!request)
    return context.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "provider and capabilities are required.",
        },
      },
      400,
    );

  try {
    const resolution = await resolveIntegrationCredentialForService(
      context.get("principal"),
      request,
    );
    return resolution
      ? context.json({ data: resolution })
      : context.json(
          {
            error: {
              code: "INTEGRATION_CREDENTIAL_NOT_FOUND",
              message:
                "No active, scoped integration satisfies the requested provider capability.",
            },
          },
          404,
        );
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message
        : "INTEGRATION_CREDENTIAL_RESOLUTION_FAILED";
    return context.json(
      {
        error: {
          code,
          message:
            code === "DATABASE_UNAVAILABLE"
              ? "Database is unavailable."
              : "Provider credential resolution failed.",
        },
      },
      code === "DATABASE_UNAVAILABLE" ? 503 : 502,
    );
  }
};
