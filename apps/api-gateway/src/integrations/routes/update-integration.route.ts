import { IntegrationStatus, isJsonObject } from "@encois/contracts";
import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  type IntegrationUpdate,
  updateIntegrationForPrincipal,
} from "../services/integrations.service.js";

function parseUpdate(value: unknown): IntegrationUpdate | null {
  if (!isJsonObject(value)) return null;

  const update: IntegrationUpdate = {};
  if (value.displayName !== undefined) {
    if (
      typeof value.displayName !== "string" ||
      value.displayName.trim().length === 0
    )
      return null;
    update.displayName = value.displayName.trim();
  }
  if (value.status !== undefined) {
    if (value.status !== IntegrationStatus.Disabled) return null;
    update.status = IntegrationStatus.Disabled;
  }

  return Object.keys(update).length > 0 ? update : null;
}

export const updateIntegrationRoute: Handler<GatewayEnv> = async (context) => {
  const update = parseUpdate(await context.req.json().catch(() => null));
  if (!update) {
    return context.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "A non-empty integration update is required.",
        },
      },
      400,
    );
  }

  try {
    const integrationId = context.req.param("integrationId");
    if (!integrationId) {
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Integration id is required.",
          },
        },
        400,
      );
    }
    const integration = await updateIntegrationForPrincipal(
      context.get("principal"),
      integrationId,
      update,
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
    if (error instanceof Error && error.message === "PERSISTENCE_UNAVAILABLE") {
      return context.json(
        {
          error: {
            code: "PERSISTENCE_UNAVAILABLE",
            message: "Database access is not configured.",
          },
        },
        503,
      );
    }
    throw error;
  }
};
