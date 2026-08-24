import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import type { IntegrationAuthorizationAdapter } from "../authorization-adapter.js";
import { completeIntegrationAuthorization } from "../services/integrations.service.js";

function successLocation(
  template: string | undefined,
  integrationId: string,
): string | undefined {
  if (!template) return undefined;
  const value = template.replaceAll(
    "{integrationId}",
    encodeURIComponent(integrationId),
  );
  try {
    const url = new URL(value, "https://relative.invalid");
    if (url.origin === "https://relative.invalid" && value.startsWith("/"))
      return value;
    if (url.protocol === "https:") return url.toString();
  } catch {
    return undefined;
  }
  return undefined;
}

export function createAuthorizationCallbackRoute(
  adapter: IntegrationAuthorizationAdapter | undefined,
  successUrl: string | undefined,
): Handler<GatewayEnv> {
  return async (context) => {
    const providerError = context.req.query("error");
    if (providerError)
      return context.json(
        {
          error: {
            code: "INTEGRATION_AUTHORIZATION_DENIED",
            message: "The provider declined authorization.",
          },
        },
        400,
      );
    const code = context.req.query("code");
    const state = context.req.query("state");
    if (!code || !state)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Provider authorization code and state are required.",
          },
        },
        400,
      );
    try {
      const result = await completeIntegrationAuthorization(adapter, {
        code,
        state,
      });
      if (!result)
        return context.json(
          {
            error: {
              code: "INTEGRATION_NOT_FOUND",
              message: "The integration could not be authorized.",
            },
          },
          404,
        );
      const location = successLocation(successUrl, result.id);
      return location
        ? context.redirect(location, 303)
        : context.json({
            data: { integrationId: result.id, status: result.status },
            message:
              "Integration authorization completed. Return to the dashboard to continue.",
          });
    } catch (error) {
      const codeValue =
        error instanceof Error
          ? error.message
          : "INTEGRATION_AUTHORIZATION_FAILED";
      const status =
        codeValue === "INTEGRATION_AUTHORIZATION_STATE_INVALID"
          ? 400
          : codeValue === "FORBIDDEN"
            ? 403
            : codeValue === "PERSISTENCE_UNAVAILABLE" ||
                codeValue === "INTEGRATION_AUTHORIZATION_UNAVAILABLE"
              ? 503
              : 502;
      return context.json(
        {
          error: {
            code: codeValue,
            message:
              codeValue === "INTEGRATION_AUTHORIZATION_STATE_INVALID"
                ? "This authorization link is expired or has already been used."
                : "The provider authorization could not be completed.",
          },
        },
        status,
      );
    }
  };
}
