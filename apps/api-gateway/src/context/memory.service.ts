import { ContractVersion, Permission, type AgentMemoryRequest, type MemoryInspectionProjection, type MemoryInspectionQueryRequest } from "@encois/contracts";
import { withOrganizationContext } from "@encois/persistence";
import { database } from "../database.js";
import { hasPermission } from "../auth/authorization.js";
import type { AosPrincipal } from "../middleware/aos.js";
import { createExecutionCapability } from "../security/execution-capability.js";
import { MemoryRuntimeClientError, type MemoryRuntimeClient } from "./memory-client.js";
import { GraphServiceError } from "./graph.service.js";

export type MemoryServiceOptions = {
  client?: MemoryRuntimeClient;
  policyVersion: string;
  capabilitySecret?: string;
  capabilityTtlMs: number;
};

function scopeFor(principal: AosPrincipal, requested: MemoryInspectionQueryRequest["scope"]): { ids: string[] } {
  const ids = [...new Set(requested?.ids ?? principal.scope)].filter(Boolean).sort();
  if (ids.length === 0) throw new GraphServiceError("INVALID_SCOPE", "At least one organization-unit scope is required.");
  if (!principal.scope.includes("*") && ids.some((id) => !principal.scope.includes(id))) throw new GraphServiceError("SCOPE_DENIED", "The requested memory scope exceeds the caller's organization-unit scope.");
  return { ids };
}

export async function queryMemoryForPrincipal(
  principal: AosPrincipal,
  input: MemoryInspectionQueryRequest,
  requestId: string,
  traceId: string,
  options: MemoryServiceOptions,
): Promise<MemoryInspectionProjection> {
  if (!database) throw new GraphServiceError("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  if (!options.client) throw new GraphServiceError("MEMORY_UNAVAILABLE", "Agent memory inspection is not configured for this environment.");
  if (!options.capabilitySecret) throw new GraphServiceError("CAPABILITY_NOT_CONFIGURED", "Memory inspection capability signing is not configured.");
  const agentDefinition = input.agentDefinition.trim();
  const query = input.query.trim();
  if (!agentDefinition || agentDefinition.length > 160 || !query || query.length > 2000) throw new GraphServiceError("INVALID_REQUEST", "Agent definition and query are required.");
  const scope = scopeFor(principal, input.scope);
  const allowed = await withOrganizationContext(database, principal.organizationId, (db) =>
    hasPermission(db, principal, Permission.MemoryRead),
  );
  if (!allowed) throw new GraphServiceError("FORBIDDEN", "Agent memory inspection permission is required.");

  const workflowId = `workflow:${principal.organizationId}:dashboard-memory:${requestId}`;
  const request: AgentMemoryRequest = {
    contractVersion: ContractVersion.AgentMemory,
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
    agentDefinition,
    operation: "retrieve",
    memoryScope: { agentDefinition, ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}) },
    query,
    maxResults: Math.min(Math.max(input.maxResults ?? 10, 1), 20),
  };

  try {
    const result = await options.client.query(request);
    return { agentDefinition, query, status: result.status, memories: result.memories, generatedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof MemoryRuntimeClientError) {
      throw new GraphServiceError(error.code === "MEMORY_RUNTIME_TIMEOUT" ? "MEMORY_TIMEOUT" : "MEMORY_RUNTIME_ERROR", error.message);
    }
    throw error;
  }
}
