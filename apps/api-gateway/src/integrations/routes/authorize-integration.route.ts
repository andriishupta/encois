import { IntegrationStatus, isJsonObject } from "@encois/contracts";
import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  authorizeIntegrationForService,
  type IntegrationAuthorizationServiceOptions,
  type IntegrationAuthorizationUpdate,
} from "../services/integrations.service.js";

function parseAuthorization(
  value: unknown,
): IntegrationAuthorizationUpdate | null {
  if (!isJsonObject(value) || typeof value.credentialRef !== "string")
    return null;
  if (
    value.status !== undefined &&
    value.status !== IntegrationStatus.Authorized
  )
    return null;
  if (
    value.lastError !== undefined &&
    (typeof value.lastError !== "string" || value.lastError.length > 2000)
  )
    return null;
  return {
    credentialRef: value.credentialRef,
    ...(value.status === IntegrationStatus.Authorized
      ? {
          status:
            IntegrationStatus.Authorized as IntegrationAuthorizationUpdate["status"],
        }
      : {}),
    ...(typeof value.lastError === "string"
      ? { lastError: value.lastError }
      : {}),
  };
}

export function createAuthorizeIntegrationRoute(
  options: IntegrationAuthorizationServiceOptions = {},
): Handler<GatewayEnv> {
  return async (context) => {
    const integrationId = context.req.param("integrationId");
    const request = parseAuthorization(
      await context.req.json().catch(() => null),
    );
    if (!integrationId || !request)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "integrationId and a valid credentialRef are required.",
          },
        },
        400,
      );

    try {
      const integration = await authorizeIntegrationForService(
        context.get("principal"),
        integrationId,
        request,
        options,
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
          : "INTEGRATION_AUTHORIZATION_FAILED";
      const status =
        code === "DATABASE_UNAVAILABLE"
          ? 503
          : code === "FORBIDDEN"
            ? 403
            : code === "INVALID_CREDENTIAL_REFERENCE"
              ? 422
              : 422;
      return context.json(
        {
          error: {
            code,
            message:
              code === "DATABASE_UNAVAILABLE"
                ? "Database is unavailable."
                : code === "INVALID_CREDENTIAL_REFERENCE"
                  ? "credentialRef must be a Secret Manager reference in hosted environments; local references are limited to development and test adapters."
                  : "The integration authorization state could not be updated.",
          },
        },
        status,
      );
    }
  };
}

export const authorizeIntegrationRoute = createAuthorizeIntegrationRoute();
