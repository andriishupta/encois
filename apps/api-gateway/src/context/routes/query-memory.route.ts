import type { Handler } from "hono";
import { isJsonObject, type MemoryInspectionQueryRequest } from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import { GraphServiceError } from "../graph.service.js";
import { queryMemoryForPrincipal, type MemoryServiceOptions } from "../memory.service.js";

function parseRequest(value: unknown): MemoryInspectionQueryRequest | null {
  if (!isJsonObject(value) || typeof value.agentDefinition !== "string" || typeof value.query !== "string") return null;
  if (value.projectId !== undefined && typeof value.projectId !== "string") return null;
  if (value.maxResults !== undefined && (typeof value.maxResults !== "number" || !Number.isInteger(value.maxResults))) return null;
  if (value.scope !== undefined && (!isJsonObject(value.scope) || !Array.isArray(value.scope.ids) || value.scope.ids.some((id) => typeof id !== "string"))) return null;
  return {
    agentDefinition: value.agentDefinition,
    query: value.query,
    ...(value.projectId ? { projectId: value.projectId } : {}),
    ...(typeof value.maxResults === "number" ? { maxResults: value.maxResults } : {}),
    ...(value.scope ? { scope: { ids: value.scope.ids as string[] } } : {}),
  };
}

function statusFor(code: string): 400 | 403 | 502 | 503 {
  if (code === "FORBIDDEN" || code === "SCOPE_DENIED") return 403;
  if (code === "MEMORY_RUNTIME_ERROR" || code === "MEMORY_TIMEOUT") return 502;
  if (code === "PERSISTENCE_UNAVAILABLE" || code === "MEMORY_UNAVAILABLE" || code === "CAPABILITY_NOT_CONFIGURED") return 503;
  return 400;
}

export function queryMemoryRoute(options: MemoryServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    const request = parseRequest(await context.req.json().catch(() => null));
    if (!request) return context.json({ error: { code: "INVALID_REQUEST", message: "Agent definition and query are required." } }, 400);
    try {
      return context.json({ data: await queryMemoryForPrincipal(context.get("principal"), request, context.get("requestId"), context.get("traceId"), options) });
    } catch (error) {
      if (!(error instanceof GraphServiceError)) throw error;
      return context.json({ error: { code: error.code, message: error.message, requestId: context.get("requestId"), traceId: context.get("traceId") } }, statusFor(error.code));
    }
  };
}
