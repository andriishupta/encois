import { randomUUID } from "node:crypto";
import {
  AgentMemoryOperation,
  type AgentMemoryRequest,
  type AgentMemoryResult,
  ContractVersion,
  type MemoryChangeRecord,
  type MemoryChangeRequest,
  Permission,
} from "@encois/contracts";
import {
  auditEvents,
  memoryChangeRequests,
  withOrganizationContext,
} from "@encois/persistence";
import { and, desc, eq } from "drizzle-orm";
import { hasPermission } from "../auth/authorization.js";
import { database } from "../database.js";
import type { AosPrincipal } from "../middleware/aos.js";
import { createExecutionCapability } from "../security/execution-capability.js";
import { localUserId } from "../workflows/services/workflow-service-common.js";
import { GraphServiceError } from "./graph.service.js";
import {
  type MemoryRuntimeClient,
  MemoryRuntimeClientError,
} from "./memory-client.js";

export type MemoryChangeServiceOptions = {
  client?: MemoryRuntimeClient;
  policyVersion: string;
  capabilitySecret?: string;
  capabilityTtlMs: number;
};

function scopeFor(
  principal: AosPrincipal,
  requested: MemoryChangeRequest["scope"],
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
  ) {
    throw new GraphServiceError(
      "SCOPE_DENIED",
      "The requested memory scope exceeds the caller's organization-unit scope.",
    );
  }
  return { ids };
}

function dateString(value: Date | null | undefined): string | undefined {
  return value?.toISOString();
}

function recordFromRow(
  row: typeof memoryChangeRequests.$inferSelect,
): MemoryChangeRecord {
  const scope = row.scope as { ids?: unknown };
  const ids = Array.isArray(scope.ids)
    ? scope.ids.filter((id): id is string => typeof id === "string")
    : [];
  return {
    id: row.id,
    organizationId: row.organizationId,
    ...(row.memoryId ? { memoryId: row.memoryId } : {}),
    agentDefinition: row.agentDefinition,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.userId ? { userId: row.userId } : {}),
    scope: { ids },
    action: row.action,
    ...(row.replacementSummary
      ? { replacementSummary: row.replacementSummary }
      : {}),
    ...(Array.isArray(row.evidenceRefs)
      ? {
          evidenceRefs: row.evidenceRefs.filter(
            (value): value is string => typeof value === "string",
          ),
        }
      : {}),
    status: row.status,
    ...(row.requestedByUserId
      ? { requestedByUserId: row.requestedByUserId }
      : {}),
    ...(row.approvedByUserId ? { approvedByUserId: row.approvedByUserId } : {}),
    ...(row.runtimeRequestId ? { runtimeRequestId: row.runtimeRequestId } : {}),
    ...(row.providerOperationName
      ? { providerOperationName: row.providerOperationName }
      : {}),
    ...(row.failureReason ? { failureReason: row.failureReason } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(dateString(row.approvedAt)
      ? { approvedAt: dateString(row.approvedAt) }
      : {}),
    ...(dateString(row.appliedAt)
      ? { appliedAt: dateString(row.appliedAt) }
      : {}),
  };
}

async function requireMemoryManager(principal: AosPrincipal): Promise<string> {
  if (!database)
    throw new GraphServiceError(
      "PERSISTENCE_UNAVAILABLE",
      "Database access is not configured.",
    );
  const userId = localUserId(principal);
  if (!userId)
    throw new GraphServiceError(
      "IDENTITY_NOT_RESOLVED",
      "The identity is not linked to a local user.",
    );
  const allowed = await withOrganizationContext(
    database,
    principal.organizationId,
    (db) => hasPermission(db, principal, Permission.MemoryManage),
  );
  if (!allowed)
    throw new GraphServiceError(
      "FORBIDDEN",
      "Memory governance permission is required.",
    );
  return userId;
}

function visible(
  row: typeof memoryChangeRequests.$inferSelect,
  principal: AosPrincipal,
): boolean {
  if (principal.scope.includes("*")) return true;
  const scope = row.scope as { ids?: unknown };
  return (
    Array.isArray(scope.ids) &&
    scope.ids.every(
      (id) => typeof id === "string" && principal.scope.includes(id),
    )
  );
}

export async function listMemoryChanges(
  principal: AosPrincipal,
  limit = 100,
): Promise<readonly MemoryChangeRecord[]> {
  if (!database)
    throw new GraphServiceError(
      "PERSISTENCE_UNAVAILABLE",
      "Database access is not configured.",
    );
  await requireMemoryManager(principal);
  const rows = await withOrganizationContext(
    database,
    principal.organizationId,
    (db) =>
      db
        .select()
        .from(memoryChangeRequests)
        .where(
          eq(memoryChangeRequests.organizationId, principal.organizationId),
        )
        .orderBy(desc(memoryChangeRequests.updatedAt))
        .limit(Math.max(1, Math.min(limit, 100))),
  );
  return rows.filter((row) => visible(row, principal)).map(recordFromRow);
}

export async function createMemoryChange(
  principal: AosPrincipal,
  input: MemoryChangeRequest,
): Promise<MemoryChangeRecord> {
  if (!database)
    throw new GraphServiceError(
      "PERSISTENCE_UNAVAILABLE",
      "Database access is not configured.",
    );
  const userId = await requireMemoryManager(principal);
  const scope = scopeFor(principal, input.scope);
  const memoryId = input.memoryId?.trim();
  const agentDefinition = input.agentDefinition.trim();
  const replacementSummary = input.replacementSummary?.trim();
  if (
    (memoryId && memoryId.length > 500) ||
    !agentDefinition ||
    agentDefinition.length > 160
  ) {
    throw new GraphServiceError(
      "INVALID_REQUEST",
      "A valid agent definition and, for an existing memory, a valid memory id are required.",
    );
  }
  if (
    input.action !== "add" &&
    input.action !== "correct" &&
    input.action !== "delete"
  ) {
    throw new GraphServiceError(
      "INVALID_REQUEST",
      "Memory changes support addition, correction, and deletion.",
    );
  }
  const evidenceRefs = [
    ...new Set(
      input.evidenceRefs?.map((value) => value.trim()).filter(Boolean) ?? [],
    ),
  ];
  if (
    evidenceRefs.some((value) => value.length > 500) ||
    evidenceRefs.length > 20
  ) {
    throw new GraphServiceError(
      "INVALID_REQUEST",
      "Evidence references must contain at most 20 values of 500 characters each.",
    );
  }
  if (input.action === "add") {
    if (memoryId)
      throw new GraphServiceError(
        "INVALID_REQUEST",
        "A new memory proposal cannot target an existing memory id.",
      );
    if (!replacementSummary || replacementSummary.length > 10000)
      throw new GraphServiceError(
        "INVALID_REQUEST",
        "A summary is required when adding memory.",
      );
    if (evidenceRefs.length === 0)
      throw new GraphServiceError(
        "INVALID_REQUEST",
        "At least one evidence reference is required when adding memory.",
      );
  } else if (!memoryId) {
    throw new GraphServiceError(
      "INVALID_REQUEST",
      "An existing memory id is required for correction or deletion.",
    );
  } else if (
    input.action === "correct" &&
    (!replacementSummary || replacementSummary.length > 10000)
  ) {
    throw new GraphServiceError(
      "INVALID_REQUEST",
      "A replacement summary is required for correction.",
    );
  } else if (
    input.action === "delete" &&
    (replacementSummary || evidenceRefs.length > 0)
  ) {
    throw new GraphServiceError(
      "INVALID_REQUEST",
      "Deletion requests cannot include a summary or evidence references.",
    );
  }

  return withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      const [created] = await db
        .insert(memoryChangeRequests)
        .values({
          organizationId: principal.organizationId,
          ...(memoryId ? { memoryId } : {}),
          agentDefinition,
          ...(input.projectId?.trim()
            ? { projectId: input.projectId.trim() }
            : {}),
          ...(input.userId?.trim() ? { userId: input.userId.trim() } : {}),
          scope,
          action: input.action,
          ...(replacementSummary ? { replacementSummary } : {}),
          ...(evidenceRefs.length ? { evidenceRefs } : {}),
          status: "proposed",
          requestedByUserId: userId,
        })
        .returning();
      if (!created)
        throw new GraphServiceError(
          "PERSISTENCE_FAILED",
          "The memory change request could not be persisted.",
        );
      await db.insert(auditEvents).values({
        organizationId: principal.organizationId,
        actorUserId: userId,
        action: "memory_change_submitted",
        outcome: "accepted",
        resourceType: "memory_change_request",
        resourceId: created.id,
        scope,
        metadata: { action: input.action, agentDefinition },
      });
      return recordFromRow(created);
    },
  );
}

async function getMemoryChange(
  principal: AosPrincipal,
  id: string,
): Promise<typeof memoryChangeRequests.$inferSelect> {
  if (!database)
    throw new GraphServiceError(
      "PERSISTENCE_UNAVAILABLE",
      "Database access is not configured.",
    );
  const row = await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      const [value] = await db
        .select()
        .from(memoryChangeRequests)
        .where(
          and(
            eq(memoryChangeRequests.id, id),
            eq(memoryChangeRequests.organizationId, principal.organizationId),
          ),
        )
        .limit(1);
      return value ?? null;
    },
  );
  if (!row || !visible(row, principal))
    throw new GraphServiceError(
      "MEMORY_CHANGE_NOT_FOUND",
      "Memory change request not found.",
    );
  return row;
}

async function setDecision(
  principal: AosPrincipal,
  id: string,
  status: "approved" | "rejected",
): Promise<MemoryChangeRecord> {
  if (!database)
    throw new GraphServiceError(
      "PERSISTENCE_UNAVAILABLE",
      "Database access is not configured.",
    );
  const userId = await requireMemoryManager(principal);
  const row = await getMemoryChange(principal, id);
  if (row.status === status) return recordFromRow(row);
  if (row.status !== "proposed")
    throw new GraphServiceError(
      "MEMORY_CHANGE_NOT_DECIDABLE",
      `Memory change request is ${row.status}.`,
    );
  const now = new Date();
  return withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      const [updated] = await db
        .update(memoryChangeRequests)
        .set({
          status,
          ...(status === "approved"
            ? { approvedByUserId: userId, approvedAt: now }
            : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(memoryChangeRequests.id, id),
            eq(memoryChangeRequests.organizationId, principal.organizationId),
            eq(memoryChangeRequests.status, "proposed"),
          ),
        )
        .returning();
      if (!updated)
        throw new GraphServiceError(
          "MEMORY_CHANGE_CONFLICT",
          "The memory change request changed concurrently.",
        );
      await db.insert(auditEvents).values({
        organizationId: principal.organizationId,
        actorUserId: userId,
        action:
          status === "approved"
            ? "memory_change_approved"
            : "memory_change_rejected",
        outcome: "accepted",
        resourceType: "memory_change_request",
        resourceId: id,
        scope: updated.scope as Record<string, unknown>,
        metadata: { action: updated.action },
      });
      return recordFromRow(updated);
    },
  );
}

export function approveMemoryChange(
  principal: AosPrincipal,
  id: string,
): Promise<MemoryChangeRecord> {
  return setDecision(principal, id, "approved");
}

export function rejectMemoryChange(
  principal: AosPrincipal,
  id: string,
): Promise<MemoryChangeRecord> {
  return setDecision(principal, id, "rejected");
}

export async function applyMemoryChange(
  principal: AosPrincipal,
  id: string,
  requestId: string,
  traceId: string,
  options: MemoryChangeServiceOptions,
): Promise<MemoryChangeRecord> {
  if (!database)
    throw new GraphServiceError(
      "PERSISTENCE_UNAVAILABLE",
      "Database access is not configured.",
    );
  const userId = await requireMemoryManager(principal);
  if (!options.client)
    throw new GraphServiceError(
      "MEMORY_UNAVAILABLE",
      "Agent memory mutation is not configured for this environment.",
    );
  if (!options.capabilitySecret)
    throw new GraphServiceError(
      "CAPABILITY_NOT_CONFIGURED",
      "Memory mutation capability signing is not configured.",
    );
  const row = await getMemoryChange(principal, id);
  if (row.status === "applied") return recordFromRow(row);
  if (row.status !== "approved")
    throw new GraphServiceError(
      "MEMORY_CHANGE_NOT_APPLICABLE",
      `Memory change request is ${row.status}.`,
    );

  const runtimeRequestId = `${requestId}:memory-change:${id}:${randomUUID()}`;
  const workflowId = `workflow:${principal.organizationId}:memory-change:${id}`;
  const scope = row.scope as { ids: string[] };
  const runtimeRequest: AgentMemoryRequest = {
    contractVersion: ContractVersion.AgentMemory,
    requestId: runtimeRequestId,
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
    agentDefinition: row.agentDefinition,
    operation:
      row.action === "add"
        ? AgentMemoryOperation.Distill
        : row.action === "correct"
          ? AgentMemoryOperation.Correct
          : AgentMemoryOperation.Delete,
    memoryScope: {
      agentDefinition: row.agentDefinition,
      ...(row.projectId ? { projectId: row.projectId } : {}),
      ...(row.userId ? { userId: row.userId } : {}),
    },
    ...(row.memoryId ? { targetMemoryId: row.memoryId } : {}),
    ...(row.replacementSummary
      ? { replacementSummary: row.replacementSummary }
      : {}),
    ...(row.action === "add"
      ? {
          distillation: {
            summary: row.replacementSummary ?? "",
            evidenceRefs: Array.isArray(row.evidenceRefs)
              ? row.evidenceRefs.filter(
                  (value): value is string => typeof value === "string",
                )
              : [],
            observedAt: row.createdAt.toISOString(),
          },
        }
      : {}),
  };

  let result: AgentMemoryResult;
  try {
    result = await options.client.mutate(runtimeRequest);
  } catch (error) {
    const message =
      error instanceof MemoryRuntimeClientError
        ? error.message
        : "The memory mutation failed.";
    await withOrganizationContext(
      database,
      principal.organizationId,
      async (db) => {
        const now = new Date();
        const [failed] = await db
          .update(memoryChangeRequests)
          .set({
            status: "failed",
            failureReason: message,
            runtimeRequestId,
            updatedAt: now,
          })
          .where(
            and(
              eq(memoryChangeRequests.id, id),
              eq(memoryChangeRequests.organizationId, principal.organizationId),
              eq(memoryChangeRequests.status, "approved"),
            ),
          )
          .returning();
        if (failed) {
          await db.insert(auditEvents).values({
            organizationId: principal.organizationId,
            actorUserId: userId,
            action: "memory_change_failed",
            outcome: "failed",
            resourceType: "memory_change_request",
            resourceId: id,
            scope: failed.scope as Record<string, unknown>,
            metadata: { action: failed.action, runtimeRequestId },
          });
        }
      },
    );
    throw new GraphServiceError(
      error instanceof MemoryRuntimeClientError &&
        error.code === "MEMORY_RUNTIME_TIMEOUT"
        ? "MEMORY_TIMEOUT"
        : "MEMORY_RUNTIME_ERROR",
      message,
    );
  }
  if (result.status !== "completed")
    throw new GraphServiceError(
      "MEMORY_CHANGE_DEFERRED",
      "The memory provider did not complete the approved change.",
    );
  const generatedMemoryId =
    row.action === "add" ? result.memories[0]?.id : row.memoryId;
  if (!generatedMemoryId)
    throw new GraphServiceError(
      "MEMORY_CHANGE_DEFERRED",
      "The memory provider completed without returning the created memory id.",
    );

  return withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      const now = new Date();
      const [updated] = await db
        .update(memoryChangeRequests)
        .set({
          memoryId: generatedMemoryId,
          status: "applied",
          runtimeRequestId,
          appliedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(memoryChangeRequests.id, id),
            eq(memoryChangeRequests.organizationId, principal.organizationId),
            eq(memoryChangeRequests.status, "approved"),
          ),
        )
        .returning();
      if (!updated)
        throw new GraphServiceError(
          "MEMORY_CHANGE_CONFLICT",
          "The memory change request changed concurrently.",
        );
      await db.insert(auditEvents).values({
        organizationId: principal.organizationId,
        actorUserId: userId,
        action: "memory_change_applied",
        outcome: "accepted",
        resourceType: "memory_change_request",
        resourceId: id,
        scope: updated.scope as Record<string, unknown>,
        metadata: { action: updated.action, runtimeRequestId },
      });
      return recordFromRow(updated);
    },
  );
}
