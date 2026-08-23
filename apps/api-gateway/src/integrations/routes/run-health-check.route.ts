import type { Handler } from "hono";
import { isJsonObject } from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import { runIntegrationHealthChecksForService, type IntegrationHealthCheckServiceOptions } from "../services/integrations.service.js";

function parseIntegrationId(value: unknown): string | null | undefined {
  if (!isJsonObject(value) || value.integrationId === undefined) return undefined;
  return typeof value.integrationId === "string" && value.integrationId.trim() ? value.integrationId.trim() : null;
}

export function runIntegrationHealthCheckRoute(options: IntegrationHealthCheckServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    const body = await context.req.json().catch(() => null);
    if (body !== null && !isJsonObject(body)) {
      return context.json({ error: { code: "INVALID_REQUEST", message: "The health-check payload must be a JSON object." } }, 400);
    }
    const integrationId = parseIntegrationId(body);
    if (integrationId === null) {
      return context.json({ error: { code: "INVALID_REQUEST", message: "integrationId must be a non-empty string when provided." } }, 400);
    }
    try {
      const result = await runIntegrationHealthChecksForService(context.get("principal"), integrationId, options);
      return context.json({ data: result });
    } catch (error) {
      const code = error instanceof Error ? error.message : "INTEGRATION_HEALTH_CHECK_FAILED";
      const status = code === "PERSISTENCE_UNAVAILABLE" || code === "AGENT_GATEWAY_UNAVAILABLE" ? 503 : code === "FORBIDDEN" ? 403 : 502;
      return context.json({ error: { code, message: status === 503 ? "The scheduled integration health check is not configured." : "The scheduled integration health check failed." } }, status);
    }
  };
}
