import { ContractVersion, Permission, type GraphInspectionProjection, type GraphInspectionQueryRequest, type GraphQueryRequest } from "@encois/contracts";
import { withOrganizationContext } from "@encois/persistence";
import { database } from "../database.js";
import type { AosPrincipal } from "../middleware/aos.js";
import { hasPermission } from "../auth/authorization.js";
import { createExecutionCapability } from "../security/execution-capability.js";
import { GraphGatewayClientError, type GraphGatewayClient } from "./graph-client.js";

export type GraphServiceOptions = {
  client?: GraphGatewayClient;
  policyVersion: string;
  capabilitySecret?: string;
  capabilityTtlMs: number;
};

export class GraphServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GraphServiceError";
    this.code = code;
  }
}

function resolvedScope(principal: AosPrincipal, requested: GraphInspectionQueryRequest["scope"]): { ids: string[] } {
  const ids = [...new Set(requested?.ids ?? principal.scope)].filter(Boolean).sort();
  if (ids.length === 0) throw new GraphServiceError("INVALID_SCOPE", "At least one organization-unit scope is required.");
  if (!principal.scope.includes("*") && ids.some((id) => !principal.scope.includes(id))) throw new GraphServiceError("SCOPE_DENIED", "The requested graph scope exceeds the caller's organization-unit scope.");
  return { ids };
}

export async function queryGraphForPrincipal(
  principal: AosPrincipal,
  input: GraphInspectionQueryRequest,
  requestId: string,
  traceId: string,
  options: GraphServiceOptions,
): Promise<GraphInspectionProjection> {
  if (!database) throw new GraphServiceError("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  if (!options.client) throw new GraphServiceError("GRAPH_UNAVAILABLE", "Graph inspection is not configured for this environment.");
  if (!options.capabilitySecret) throw new GraphServiceError("CAPABILITY_NOT_CONFIGURED", "Graph inspection capability signing is not configured.");

  const scope = resolvedScope(principal, input.scope);
  const allowed = await withOrganizationContext(database, principal.organizationId, (db) =>
    hasPermission(db, principal, Permission.ContextRead),
  );
  if (!allowed) throw new GraphServiceError("FORBIDDEN", "Context graph inspection permission is required.");

  const workflowId = `workflow:${principal.organizationId}:dashboard-graph:${requestId}`;
  const request: GraphQueryRequest = {
    contractVersion: ContractVersion.GraphQuery,
    requestId,
    traceId,
    workflowId,
    organizationId: principal.organizationId,
    actorId: principal.actorId,
    policyVersion: options.policyVersion,
    scope,
    capability: createExecutionCapability({
      secret: options.capabilitySecret,
      organizationId: principal.organizationId,
      workflowId,
      actorId: principal.actorId,
      policyVersion: options.policyVersion,
      scope,
      ttlMs: options.capabilityTtlMs,
    }),
    query: input.query,
    ...(input.params ? { params: input.params } : {}),
  };

  try {
    const result = await options.client.query(request);
    return {
      query: input.query,
      status: result.status,
      nodes: result.nodes,
      edges: result.edges,
      ...(result.evidenceRefs ? { evidenceRefs: result.evidenceRefs } : {}),
      ...(result.freshness ? { freshness: result.freshness } : {}),
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof GraphGatewayClientError) {
      if (error.code === "GRAPH_GATEWAY_TIMEOUT") throw new GraphServiceError("GRAPH_TIMEOUT", error.message);
      throw new GraphServiceError("GRAPH_GATEWAY_ERROR", error.message);
    }
    throw error;
  }
}
