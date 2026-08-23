import type { Handler } from "hono";
import { isJsonObject, type GraphInspectionQueryRequest, type GraphInspectorQueryName } from "@encois/contracts";
import type { GatewayEnv } from "../../middleware/aos.js";
import { queryGraphForPrincipal, type GraphServiceOptions, GraphServiceError } from "../graph.service.js";

const allowedQueries = new Set<GraphInspectorQueryName>(["all", "all_context", "source.facts", "project.related_entities", "release.blockers"]);

function parseRequest(value: unknown): GraphInspectionQueryRequest | null {
  if (!isJsonObject(value) || typeof value.query !== "string" || !allowedQueries.has(value.query as GraphInspectorQueryName)) return null;
  if (value.params !== undefined && !isJsonObject(value.params)) return null;
  if (value.params && (
    (value.params.projectId !== undefined && typeof value.params.projectId !== "string")
    || (value.params.nodeType !== undefined && typeof value.params.nodeType !== "string")
    || (value.params.relationship !== undefined && typeof value.params.relationship !== "string")
    || (value.params.limit !== undefined && (typeof value.params.limit !== "number" || !Number.isInteger(value.params.limit)))
  )) return null;
  const projectId = typeof value.params?.projectId === "string" ? value.params.projectId.trim() || undefined : undefined;
  const nodeType = typeof value.params?.nodeType === "string" ? value.params.nodeType : undefined;
  const relationship = typeof value.params?.relationship === "string" ? value.params.relationship : undefined;
  const limit = typeof value.params?.limit === "number" ? value.params.limit : undefined;
  if (value.query === "project.related_entities" && !projectId?.trim()) return null;
  if (projectId && projectId.length > 160) return null;
  if (nodeType && (nodeType.length < 1 || nodeType.length > 80)) return null;
  if (relationship && (relationship.length < 1 || relationship.length > 120)) return null;
  if (limit !== undefined && (limit < 1 || limit > 500)) return null;
  if (value.scope !== undefined && (!isJsonObject(value.scope) || !Array.isArray(value.scope.ids) || value.scope.ids.some((id) => typeof id !== "string"))) return null;
  return {
    query: value.query as GraphInspectorQueryName,
    ...(value.params ? { params: {
      ...(projectId ? { projectId } : {}),
      ...(nodeType ? { nodeType } : {}),
      ...(relationship ? { relationship } : {}),
      ...(limit !== undefined ? { limit } : {}),
    } } : {}),
    ...(value.scope ? { scope: { ids: value.scope.ids as string[] } } : {}),
  };
}

function statusFor(code: string): 400 | 403 | 502 | 503 {
  if (code === "FORBIDDEN" || code === "SCOPE_DENIED") return 403;
  if (code === "GRAPH_GATEWAY_ERROR" || code === "GRAPH_TIMEOUT") return 502;
  if (code === "PERSISTENCE_UNAVAILABLE" || code === "GRAPH_UNAVAILABLE" || code === "CAPABILITY_NOT_CONFIGURED") return 503;
  return 400;
}

export function queryGraphRoute(options: GraphServiceOptions): Handler<GatewayEnv> {
  return async (context) => {
    const request = parseRequest(await context.req.json().catch(() => null));
    if (!request) return context.json({ error: { code: "INVALID_REQUEST", message: "A supported graph query and optional scope are required." } }, 400);
    try {
      return context.json({ data: await queryGraphForPrincipal(context.get("principal"), request, context.get("requestId"), context.get("traceId"), options) });
    } catch (error) {
      if (!(error instanceof GraphServiceError)) throw error;
      return context.json({ error: { code: error.code, message: error.message, requestId: context.get("requestId"), traceId: context.get("traceId") } }, statusFor(error.code));
    }
  };
}
