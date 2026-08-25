import {
  type AgentMemoryRequest,
  ContractVersion,
  type MemoryInspectionProjection,
  type MemoryInspectionQueryRequest,
  Permission,
} from "@encois/contracts";
import { withOrganizationContext } from "@encois/persistence";
import { hasPermission } from "../auth/authorization.js";
import { database } from "../database.js";
import type { AosPrincipal } from "../middleware/aos.js";
import { createExecutionCapability } from "../security/execution-capability.js";
import { GraphServiceError } from "./graph.service.js";
import {
  type MemoryRuntimeClient,
  MemoryRuntimeClientError,
} from "./memory-client.js";

export type MemoryServiceOptions = {
  client?: MemoryRuntimeClient;
  policyVersion: string;
  capabilitySecret?: string;
  capabilityTtlMs: number;
};

// TODO: replace this compatibility list with the persisted agent registry when
// the control plane exposes it. Empty agentDefinition queries fan out only to
// definitions explicitly supported by the current Dashboard contract.
const dashboardMemoryAgentDefinitions = [
  "context.synthesizer@1",
  "release-investigation.synthesizer@1",
  "source-ingestion",
] as const;

function scopeFor(
  principal: AosPrincipal,
  requested: MemoryInspectionQueryRequest["scope"],
): { ids: string[] } {
  const ids = [...new Set(requested?.ids ?? principal.scope)]
    .filter(Boolean)
    .sort();
  if (ids.length === 0)
    throw new GraphServiceError(
      "INVALID_SCOPE",
      "At least one organization-unit scope is required.",
    );
  if (
    !principal.scope.includes("*") &&
    ids.some((id) => !principal.scope.includes(id))
  )
    throw new GraphServiceError(
      "SCOPE_DENIED",
      "The requested memory scope exceeds the caller's organization-unit scope.",
    );
  return { ids };
}

export async function queryMemoryForPrincipal(
  principal: AosPrincipal,
  input: MemoryInspectionQueryRequest,
  requestId: string,
  traceId: string,
  options: MemoryServiceOptions,
): Promise<MemoryInspectionProjection> {
  if (!database)
    throw new GraphServiceError(
      "PERSISTENCE_UNAVAILABLE",
      "Database access is not configured.",
    );
  if (!options.client)
    throw new GraphServiceError(
      "MEMORY_UNAVAILABLE",
      "Agent memory inspection is not configured for this environment.",
    );
  if (!options.capabilitySecret)
    throw new GraphServiceError(
      "CAPABILITY_NOT_CONFIGURED",
      "Memory inspection capability signing is not configured.",
    );
  const client = options.client;
  const capabilitySecret = options.capabilitySecret;
  const requestedAgentDefinition = input.agentDefinition?.trim();
  const query = input.query?.trim() ?? "";
  if (
    (input.agentDefinition !== undefined &&
      (!requestedAgentDefinition || requestedAgentDefinition.length > 160)) ||
    query.length > 2000
  )
    throw new GraphServiceError(
      "INVALID_REQUEST",
      "Memory query values are invalid.",
    );
  const scope = scopeFor(principal, input.scope);
  const allowed = await withOrganizationContext(
    database,
    principal.organizationId,
    (db) => hasPermission(db, principal, Permission.MemoryRead),
  );
  if (!allowed)
    throw new GraphServiceError(
      "FORBIDDEN",
      "Agent memory inspection permission is required.",
    );

  const agentDefinitions = requestedAgentDefinition
    ? [requestedAgentDefinition]
    : dashboardMemoryAgentDefinitions;
  const projectId = input.projectId?.trim();
  const maxResults = Math.min(Math.max(input.maxResults ?? 10, 1), 20);
  const baseWorkflowId = `workflow:${principal.organizationId}:dashboard-memory:${requestId}`;
  const requests: AgentMemoryRequest[] = agentDefinitions.map(
    (agentDefinition) => {
      const workflowId = `${baseWorkflowId}:${agentDefinition}`;
      return {
        contractVersion: ContractVersion.AgentMemory,
        requestId,
        traceId,
        workflowId,
        organizationId: principal.organizationId,
        actorId: principal.actorId,
        policyVersion: options.policyVersion,
        scope,
        capability: createExecutionCapability({
          secret: capabilitySecret,
          organizationId: principal.organizationId,
          workflowId,
          actorId: principal.actorId,
          policyVersion: options.policyVersion,
          scope,
          ttlMs: options.capabilityTtlMs,
        }),
        agentDefinition,
        operation: "retrieve",
        memoryScope: {
          agentDefinition,
          ...(projectId ? { projectId } : {}),
        },
        ...(query ? { query } : {}),
        maxResults,
      };
    },
  );

  try {
    const results = await Promise.all(
      requests.map((request) => client.query(request)),
    );
    const memories = results
      .flatMap((result) => result.memories)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
      .slice(0, maxResults);
    const status = results.some((result) => result.status === "failed")
      ? "failed"
      : results.some((result) => result.status === "deferred")
        ? "deferred"
        : "completed";
    return {
      agentDefinition: requestedAgentDefinition ?? "all",
      query,
      scope,
      ...(projectId ? { projectId } : {}),
      status,
      memories,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof MemoryRuntimeClientError) {
      throw new GraphServiceError(
        error.code === "MEMORY_RUNTIME_TIMEOUT"
          ? "MEMORY_TIMEOUT"
          : "MEMORY_RUNTIME_ERROR",
        error.message,
      );
    }
    throw error;
  }
}
