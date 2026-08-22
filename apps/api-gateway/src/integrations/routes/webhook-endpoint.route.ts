import type { Handler } from "hono";
import type { GatewayEnv } from "../../middleware/aos.js";
import {
  getWebhookEndpointForPrincipal,
  isWebhookEndpointServiceError,
  provisionWebhookEndpoint,
  rotateWebhookEndpointSecret,
  setWebhookEndpointStatus,
  type WebhookEndpointServiceOptions,
} from "../services/webhook-endpoint.service.js";

function serviceStatus(code: string): 400 | 403 | 404 | 409 | 503 | 422 {
  if (code === "PERSISTENCE_UNAVAILABLE" || code.includes("SECRET_STORE") || code.includes("SECRET_WRITER")) return 503;
  if (code === "FORBIDDEN" || code === "IDENTITY_NOT_RESOLVED") return 403;
  if (code.includes("NOT_FOUND")) return 404;
  if (code.includes("EXISTS") || code.includes("DISABLED") || code === "INTEGRATION_NOT_ACTIVE") return 409;
  if (code.includes("INVALID")) return 400;
  return 422;
}

function errorResponse(context: Parameters<Handler<GatewayEnv>>[0], error: unknown) {
  if (!isWebhookEndpointServiceError(error)) throw error;
  const code = error.code;
  return context.json({ error: { code, message: code === "PERSISTENCE_UNAVAILABLE" ? "Database access is not configured." : "The webhook endpoint operation could not be completed.", requestId: context.get("requestId"), traceId: context.get("traceId") } }, serviceStatus(code));
}

export function getWebhookEndpointRoute(options: WebhookEndpointServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    try {
      const data = await getWebhookEndpointForPrincipal(context.get("principal"), context.req.param("integrationId") ?? "", options);
      return data ? context.json({ data }) : context.json({ error: { code: "WEBHOOK_ENDPOINT_NOT_FOUND", message: "Webhook endpoint not found." } }, 404);
    } catch (error) {
      return errorResponse(context, error);
    }
  };
}

export function provisionWebhookEndpointRoute(options: WebhookEndpointServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    let body: unknown = {};
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: { code: "INVALID_REQUEST_BODY", message: "Request body must be valid JSON.", requestId: context.get("requestId"), traceId: context.get("traceId") } }, 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return context.json({ error: { code: "INVALID_REQUEST_BODY", message: "Request body must be an object.", requestId: context.get("requestId"), traceId: context.get("traceId") } }, 400);
    }
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      const candidate = (body as Record<string, unknown>).endpointKey;
      if (candidate !== undefined && typeof candidate !== "string") {
        return context.json({ error: { code: "INVALID_WEBHOOK_ENDPOINT_KEY", message: "endpointKey must be a string.", requestId: context.get("requestId"), traceId: context.get("traceId") } }, 400);
      }
    }
    const requestedEndpointKey = typeof (body as Record<string, unknown>).endpointKey === "string" ? (body as Record<string, unknown>).endpointKey as string : undefined;
    try {
      const data = await provisionWebhookEndpoint(context.get("principal"), context.req.param("integrationId") ?? "", requestedEndpointKey, options);
      context.header("Cache-Control", "no-store");
      context.header("Pragma", "no-cache");
      return context.json({ data }, 201);
    } catch (error) {
      return errorResponse(context, error);
    }
  };
}

export function rotateWebhookEndpointRoute(options: WebhookEndpointServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    try {
      const data = await rotateWebhookEndpointSecret(context.get("principal"), context.req.param("integrationId") ?? "", options);
      context.header("Cache-Control", "no-store");
      context.header("Pragma", "no-cache");
      return context.json({ data }, 200);
    } catch (error) {
      return errorResponse(context, error);
    }
  };
}

export function setWebhookEndpointStatusRoute(options: WebhookEndpointServiceOptions, status: "active" | "disabled"): Handler<GatewayEnv> {
  return async (context) => {
    try {
      const data = await setWebhookEndpointStatus(context.get("principal"), context.req.param("integrationId") ?? "", status, options);
      return data ? context.json({ data }) : context.json({ error: { code: "WEBHOOK_ENDPOINT_NOT_FOUND", message: "Webhook endpoint not found." } }, 404);
    } catch (error) {
      return errorResponse(context, error);
    }
  };
}
