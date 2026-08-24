import { IntegrationStatus, isJsonObject } from "@encois/contracts";
import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  type IntegrationHealthUpdate,
  reportIntegrationHealthForService,
} from "../services/integrations.service.js";

function parseHealthUpdate(value: unknown): IntegrationHealthUpdate | null {
  if (
    !isJsonObject(value) ||
    typeof value.integrationId !== "string" ||
    typeof value.status !== "string"
  )
    return null;
  const statuses = new Set<string>([
    IntegrationStatus.Active,
    IntegrationStatus.Degraded,
    IntegrationStatus.NeedsReauth,
    IntegrationStatus.Error,
  ]);
  if (!statuses.has(value.status)) return null;
  if (
    value.lastError !== undefined &&
    (typeof value.lastError !== "string" || value.lastError.length > 2000)
  )
    return null;
  return {
    integrationId: value.integrationId,
    status: value.status as IntegrationHealthUpdate["status"],
    ...(typeof value.lastError === "string"
      ? { lastError: value.lastError }
      : {}),
  };
}

export const reportIntegrationHealthRoute: Handler<GatewayEnv> = async (
  context,
) => {
  const request = parseHealthUpdate(await context.req.json().catch(() => null));
  if (!request)
    return context.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message:
            "integrationId, status, and an optional bounded lastError are required.",
        },
      },
      400,
    );

  try {
    const integration = await reportIntegrationHealthForService(
      context.get("principal"),
      request,
    );
    return integration
      ? context.json({ data: integration })
      : context.json(
          {
            error: {
              code: "INTEGRATION_NOT_FOUND",
              message: "Integration not found.",
            },
          },
          404,
        );
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message
        : "INTEGRATION_HEALTH_UPDATE_FAILED";
    const status =
      code === "PERSISTENCE_UNAVAILABLE"
        ? 503
        : code === "FORBIDDEN"
          ? 403
          : 502;
    return context.json(
      {
        error: {
          code,
          message:
            code === "PERSISTENCE_UNAVAILABLE"
              ? "Database access is not configured."
              : "The integration health state could not be updated.",
        },
      },
      status,
    );
  }
};
