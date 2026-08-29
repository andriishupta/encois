import { createHash, randomUUID } from "node:crypto";
import type {
  ExecutionScope,
  JsonObject,
  WorkflowBlueprint,
} from "@encois/contracts";
import {
  ContractVersion,
  isJsonObject,
  Permission,
  parseWorkflowBlueprint,
  TemporalWorkflowType,
  WorkflowExecutionStatus,
} from "@encois/contracts";
import {
  auditEvents,
  type DatabaseTransaction,
  idempotencyKeys,
  organizationMemberships,
  rolePermissions,
  withOrganizationContext,
  workflowBlueprints,
  workflowCommandReceipts,
  workflowDefinitions,
  workflowEvents,
  workflowRuns,
} from "@encois/database";
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import {
  hasPermission,
  hasPrincipalPermission,
} from "../../auth/authorization.js";
import { database } from "../../database.js";
import type { AosPrincipal } from "../../middleware/aos.js";
import { createExecutionCapability } from "../../security/execution-capability.js";
import { type ListPage, type ListQuery, listPage } from "../list-query.js";
import type { WorkflowClient } from "../temporal-client.js";
import {
  buildWorkflowId,
  type WorkflowEventProjection,
  type WorkflowExecutionProjection,
  type WorkflowRecentActivityProjection,
  type WorkflowSignalRequest,
  type WorkflowStartRequest,
  type WorkflowUpdateRequest,
} from "../types.js";
import {
  projectRuntimeWorkflowResult,
  syncWorkflowProjection,
  workflowEventProjection,
} from "./workflow-runtime-projection.service.js";
import {
  localUserId,
  persistedWorkflowRunStatus,
  stableSerialize,
  workflowServiceError,
} from "./workflow-service-common.js";

export {
  isWorkflowServiceError,
  localUserId,
  stableSerialize,
  type WorkflowServiceError,
  workflowServiceError,
} from "./workflow-service-common.js";

export type WorkflowServiceOptions = {
  workflowClient: WorkflowClient;
  policyVersion: string;
  namespace: string;
  taskQueue: string;
  capabilitySecret?: string;
  capabilityTtlMs?: number;
  workflowRunRetentionDays?: number;
};

function workflowScopeIsVisible(
  scope: unknown,
  principalScope: readonly string[],
): boolean {
  if (!isJsonObject(scope) || !Array.isArray(scope.ids)) return false;
  if (principalScope.includes("*")) return true;
  return scope.ids.some(
    (id) => typeof id === "string" && principalScope.includes(id),
  );
}

function parseExecutionScope(value: unknown): ExecutionScope | undefined {
  if (!isJsonObject(value) || !Array.isArray(value.ids)) return undefined;
  const ids = value.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== value.ids.length) return undefined;
  return { ids: [...new Set(ids)] };
}

function blueprintFromPayload(
  payload: JsonObject,
): WorkflowBlueprint | undefined {
  if (isJsonObject(payload.blueprint))
    return parseWorkflowBlueprint(payload.blueprint) ?? undefined;
  if (
    payload.workflowType === TemporalWorkflowType.Dynamic &&
    Array.isArray(payload.steps)
  ) {
    return parseWorkflowBlueprint(payload) ?? undefined;
  }
  return undefined;
}

function getBlueprint(
  request: WorkflowStartRequest,
  payload: JsonObject,
): WorkflowBlueprint | undefined {
  if (request.workflowType !== TemporalWorkflowType.Dynamic) return undefined;
  return request.blueprint ?? blueprintFromPayload(payload);
}

function getBusinessInput(
  request: WorkflowStartRequest,
  payload: JsonObject,
): JsonObject {
  if (isJsonObject(payload.businessInput)) return payload.businessInput;
  if (!request.blueprint) return payload;
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== "blueprint"),
  );
}

function startCommand(
  principal: AosPrincipal,
  request: WorkflowStartRequest,
  requestId: string,
  traceId: string,
  workflowId: string,
  taskQueue: string,
  policyVersion: string,
  requestHash: string,
  capabilitySecret: string,
  capabilityTtlMs: number | undefined,
  lineage: WorkflowStartLineage = {},
) {
  const payload = request.input ?? {};
  const blueprint = getBlueprint(request, payload);
  const businessInput = getBusinessInput(request, payload);
  const requestedScope = request.scope;
  if (
    requestedScope &&
    Object.keys(requestedScope).some((key) => key !== "ids")
  ) {
    throw workflowServiceError(
      "INVALID_SCOPE",
      "Execution scope may contain only organization-unit ids.",
    );
  }
  const requestedIds = requestedScope?.ids;
  if (requestedIds !== undefined && requestedIds.length === 0) {
    throw workflowServiceError(
      "INVALID_SCOPE",
      "Execution scope must contain at least one organization-unit id.",
    );
  }
  const scope: ExecutionScope = {
    ids: [...new Set(requestedIds ?? principal.scope)].sort(),
  };
  if (
    !principal.scope.includes("*") &&
    scope.ids.some((id) => !principal.scope.includes(id))
  ) {
    throw workflowServiceError(
      "SCOPE_DENIED",
      "The requested workflow scope exceeds the caller's organization-unit scope.",
    );
  }
  const capability = createExecutionCapability({
    secret: capabilitySecret,
    organizationId: principal.organizationId,
    workflowId,
    actorId: principal.actorId,
    policyVersion,
    scope,
    ttlMs: capabilityTtlMs,
  });
  return {
    workflowType: request.workflowType,
    workflowId,
    taskQueue,
    input: {
      contractVersion: ContractVersion.WorkflowBlueprint,
      actorId: principal.actorId,
      organizationId: principal.organizationId,
      requestId,
      traceId,
      workflowId,
      policyVersion,
      scope,
      capability,
      userId: principal.userId,
      blueprint,
      blueprintVersion: blueprint?.version ?? request.blueprintVersion,
      businessInput: businessInput as JsonObject,
      payload: payload as JsonObject,
      idempotencyKey: request.idempotencyKey,
      ...lineage,
    },
    requestHash,
  };
}

export type WorkflowStartLineage = {
  parentWorkflowId?: string;
  trigger?: "manual" | "rerun";
};

type WorkflowCommandType = "signal" | "update";

type WorkflowCommandClaim = "send" | "replay";

function workflowCommandHash(
  request: WorkflowSignalRequest | WorkflowUpdateRequest,
): string {
  return createHash("sha256").update(stableSerialize(request)).digest("hex");
}

async function claimWorkflowCommand(
  db: DatabaseTransaction,
  organizationId: string,
  workflowRunId: string,
  workflowId: string,
  commandType: WorkflowCommandType,
  commandId: string,
  requestHash: string,
  conflictCode: string,
): Promise<WorkflowCommandClaim> {
  const where = and(
    eq(workflowCommandReceipts.organizationId, organizationId),
    eq(workflowCommandReceipts.temporalWorkflowId, workflowId),
    eq(workflowCommandReceipts.commandType, commandType),
    eq(workflowCommandReceipts.commandId, commandId),
  );
  const [existing] = await db
    .select({
      requestHash: workflowCommandReceipts.requestHash,
      status: workflowCommandReceipts.status,
    })
    .from(workflowCommandReceipts)
    .where(where)
    .limit(1);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw workflowServiceError(
        conflictCode,
        `The ${commandType} ID already belongs to a different payload.`,
      );
    }
    return existing.status === "accepted" ? "replay" : "send";
  }

  const [created] = await db
    .insert(workflowCommandReceipts)
    .values({
      organizationId,
      workflowRunId,
      temporalWorkflowId: workflowId,
      commandType,
      commandId,
      requestHash,
      status: "in_flight",
    })
    .onConflictDoNothing()
    .returning({ id: workflowCommandReceipts.id });
  if (created) return "send";

  // A concurrent request claimed the same command. Re-read it and apply the
  // same hash/status rules; replaying an in-flight command is intentional
  // because Temporal and the Go Workflow provide the second idempotency layer.
  const [raced] = await db
    .select({
      requestHash: workflowCommandReceipts.requestHash,
      status: workflowCommandReceipts.status,
    })
    .from(workflowCommandReceipts)
    .where(where)
    .limit(1);
  if (!raced)
    throw workflowServiceError(
      "WORKFLOW_COMMAND_RECEIPT_FAILED",
      "The workflow command receipt could not be claimed.",
    );
  if (raced.requestHash !== requestHash) {
    throw workflowServiceError(
      conflictCode,
      `The ${commandType} ID already belongs to a different payload.`,
    );
  }
  return raced.status === "accepted" ? "replay" : "send";
}

async function markWorkflowCommandFailed(
  db: DatabaseTransaction,
  organizationId: string,
  workflowId: string,
  commandType: WorkflowCommandType,
  commandId: string,
  error: string,
): Promise<void> {
  await db
    .update(workflowCommandReceipts)
    .set({
      status: "failed",
      error: error.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workflowCommandReceipts.organizationId, organizationId),
        eq(workflowCommandReceipts.temporalWorkflowId, workflowId),
        eq(workflowCommandReceipts.commandType, commandType),
        eq(workflowCommandReceipts.commandId, commandId),
      ),
    );
}

async function markWorkflowCommandAccepted(
  db: DatabaseTransaction,
  organizationId: string,
  workflowId: string,
  commandType: WorkflowCommandType,
  commandId: string,
): Promise<void> {
  await db
    .update(workflowCommandReceipts)
    .set({ status: "accepted", error: null, updatedAt: new Date() })
    .where(
      and(
        eq(workflowCommandReceipts.organizationId, organizationId),
        eq(workflowCommandReceipts.temporalWorkflowId, workflowId),
        eq(workflowCommandReceipts.commandType, commandType),
        eq(workflowCommandReceipts.commandId, commandId),
      ),
    );
}

function requestHash(request: WorkflowStartRequest): string {
  return createHash("sha256").update(stableSerialize(request)).digest("hex");
}

async function resolveStoredBlueprint(
  db: DatabaseTransaction,
  organizationId: string,
  request: WorkflowStartRequest,
): Promise<WorkflowStartRequest> {
  if (request.blueprint || !request.blueprintId) return request;
  if (!request.blueprintVersion) {
    throw workflowServiceError(
      "BLUEPRINT_VERSION_REQUIRED",
      "blueprintVersion is required when starting a stored Blueprint.",
    );
  }

  const [row] = await db
    .select({
      blueprint: workflowBlueprints.blueprint,
      status: workflowBlueprints.status,
    })
    .from(workflowBlueprints)
    .where(
      and(
        eq(workflowBlueprints.organizationId, organizationId),
        eq(workflowBlueprints.blueprintId, request.blueprintId),
        eq(workflowBlueprints.version, request.blueprintVersion),
        isNull(workflowBlueprints.deletedAt),
      ),
    )
    .limit(1);
  if (row?.status !== "approved") {
    throw workflowServiceError(
      "BLUEPRINT_NOT_FOUND",
      "The requested approved Blueprint snapshot was not found.",
    );
  }
  const blueprint = parseWorkflowBlueprint(row.blueprint);
  if (!blueprint)
    throw workflowServiceError(
      "BLUEPRINT_INVALID",
      "The stored Blueprint snapshot is invalid.",
    );
  return { ...request, blueprint };
}

function isIdempotencyConflict(error: unknown): boolean {
  return error instanceof Error && error.message === "idempotency conflict";
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export {
  parseRuntimeWorkflowResult,
  workflowEventProjection,
} from "./workflow-runtime-projection.service.js";
export async function startWorkflow(
  principal: AosPrincipal,
  request: WorkflowStartRequest,
  requestId: string,
  traceId: string,
  options: WorkflowServiceOptions,
  lineage: WorkflowStartLineage = {},
): Promise<WorkflowExecutionProjection> {
  const workflowId = buildWorkflowId({
    organizationId: principal.organizationId,
    organizationUnitId: request.scope?.ids?.[0] ?? principal.organizationId,
    key: request.key ?? request.idempotencyKey ?? requestId,
  });
  const fingerprint = requestHash(request);
  const capabilitySecret = options.capabilitySecret;

  if (!capabilitySecret) {
    throw workflowServiceError(
      "CAPABILITY_NOT_CONFIGURED",
      "Execution capability signing is not configured.",
    );
  }

  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRun)) {
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot start workflows.",
      );
    }
    if (request.blueprintId && !request.blueprint) {
      throw workflowServiceError(
        "BLUEPRINT_REGISTRY_UNAVAILABLE",
        "A stored Blueprint requires a configured database.",
      );
    }
    try {
      return await options.workflowClient.start(
        startCommand(
          principal,
          request,
          requestId,
          traceId,
          workflowId,
          options.taskQueue,
          options.policyVersion,
          fingerprint,
          capabilitySecret,
          options.capabilityTtlMs,
          lineage,
        ),
        options.namespace,
      );
    } catch (error) {
      if (isIdempotencyConflict(error)) {
        throw workflowServiceError(
          "IDEMPOTENCY_CONFLICT",
          "The workflow key already belongs to a different request.",
        );
      }
      throw error;
    }
  }

  const userId = localUserId(principal);
  if (!userId)
    throw workflowServiceError(
      "IDENTITY_NOT_RESOLVED",
      "The identity is not linked to a local user.",
    );

  return withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (!(await hasPermission(db, principal, Permission.WorkflowsRun))) {
        throw workflowServiceError(
          "FORBIDDEN",
          "The user cannot start workflows.",
        );
      }

      const [workflowIdentity] = await db
        .select({ requestHash: idempotencyKeys.requestHash })
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.organizationId, principal.organizationId),
            eq(idempotencyKeys.key, workflowId),
          ),
        )
        .limit(1);
      if (workflowIdentity && workflowIdentity.requestHash !== fingerprint) {
        throw workflowServiceError(
          "IDEMPOTENCY_CONFLICT",
          "The workflow key already belongs to a different request.",
        );
      }

      const explicitIdempotencyKey = request.idempotencyKey;
      if (explicitIdempotencyKey && explicitIdempotencyKey !== workflowId) {
        const [existingIdempotency] = await db
          .select({ requestHash: idempotencyKeys.requestHash })
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.organizationId, principal.organizationId),
              eq(idempotencyKeys.key, explicitIdempotencyKey),
            ),
          )
          .limit(1);
        if (
          existingIdempotency &&
          existingIdempotency.requestHash !== fingerprint
        ) {
          throw workflowServiceError(
            "IDEMPOTENCY_CONFLICT",
            "The idempotency key already belongs to a different request.",
          );
        }
      }

      const [existingRun] = await db
        .select({
          id: workflowRuns.id,
          workflowId: workflowRuns.temporalWorkflowId,
          name: workflowRuns.name,
          status: workflowRuns.status,
          blueprintId: workflowRuns.blueprintId,
          blueprintVersion: workflowRuns.blueprintVersion,
          scope: workflowRuns.scope,
          businessInput: workflowRuns.businessInput,
        })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.organizationId, principal.organizationId),
            eq(workflowRuns.temporalWorkflowId, workflowId),
          ),
        )
        .limit(1);
      if (existingRun) {
        const existingProjection = await options.workflowClient.get(
          workflowId,
          principal.organizationId,
          options.namespace,
        );
        if (existingProjection)
          return {
            ...existingProjection,
            ...(existingRun.name ? { name: existingRun.name } : {}),
            reused: true,
          };
        if (existingRun.status !== WorkflowExecutionStatus.Queued)
          throw workflowServiceError(
            "WORKFLOW_PROJECTION_MISSING",
            "The active workflow projection is unavailable.",
          );
        if (
          existingRun.blueprintId !== request.blueprintId ||
          existingRun.blueprintVersion !== request.blueprintVersion ||
          stableSerialize(existingRun.scope) !==
            stableSerialize(request.scope ?? { ids: principal.scope }) ||
          stableSerialize(existingRun.businessInput) !==
            stableSerialize(request.input ?? {})
        )
          throw workflowServiceError(
            "IDEMPOTENCY_CONFLICT",
            "The queued workflow belongs to a different start request.",
          );
      }

      const effectiveRequest = await resolveStoredBlueprint(
        db,
        principal.organizationId,
        request,
      );
      const version = effectiveRequest.version ?? "v1";
      const [definition] = await db
        .select({ id: workflowDefinitions.id })
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.key, effectiveRequest.workflowType),
            eq(workflowDefinitions.version, version),
            eq(workflowDefinitions.status, "approved"),
            or(
              isNull(workflowDefinitions.organizationId),
              eq(workflowDefinitions.organizationId, principal.organizationId),
            ),
          ),
        )
        .limit(1);
      if (!definition) {
        throw workflowServiceError(
          "WORKFLOW_DEFINITION_NOT_FOUND",
          `No approved workflow definition exists for ${request.workflowType}@${version}.`,
        );
      }

      const command = startCommand(
        principal,
        effectiveRequest,
        requestId,
        traceId,
        workflowId,
        options.taskQueue,
        options.policyVersion,
        fingerprint,
        capabilitySecret,
        options.capabilityTtlMs,
        lineage,
      );
      const projection = await options.workflowClient.start(
        command,
        options.namespace,
      );
      const retentionUntil = new Date(
        Date.now() +
          (options.workflowRunRetentionDays ?? 30) * 24 * 60 * 60 * 1000,
      );

      const workflowRun = existingRun
        ? (
            await db
              .update(workflowRuns)
              .set({
                definitionId: definition.id,
                temporalNamespace: projection.namespace,
                temporalTaskQueue: projection.taskQueue,
                temporalRunId: projection.runId,
                status: persistedWorkflowRunStatus(projection.status),
                scope: command.input.scope,
                businessInput: command.input.businessInput ?? {},
                retentionUntil,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workflowRuns.organizationId, principal.organizationId),
                  eq(workflowRuns.id, existingRun.id),
                  eq(workflowRuns.status, WorkflowExecutionStatus.Queued),
                ),
              )
              .returning({ id: workflowRuns.id })
          )[0]
        : (
            await db
              .insert(workflowRuns)
              .values({
                organizationId: principal.organizationId,
                definitionId: definition.id,
                actorUserId: userId,
                temporalNamespace: projection.namespace,
                temporalTaskQueue: projection.taskQueue,
                temporalWorkflowId: projection.workflowId,
                temporalRunId: projection.runId,
                name:
                  command.input.blueprint?.name ??
                  request.key ??
                  request.workflowType,
                blueprintId: command.input.blueprint?.blueprintId,
                blueprintVersion:
                  command.input.blueprint?.version ??
                  command.input.blueprintVersion,
                parentWorkflowId: command.input.parentWorkflowId,
                trigger: command.input.trigger ?? "manual",
                status: persistedWorkflowRunStatus(projection.status),
                scope: command.input.scope,
                businessInput: command.input.businessInput ?? {},
                retentionUntil,
              })
              .returning({ id: workflowRuns.id })
          )[0];

      if (workflowRun) {
        await db.insert(workflowEvents).values({
          organizationId: principal.organizationId,
          workflowRunId: workflowRun.id,
          eventType: projection.reused ? "workflow_reused" : "workflow_started",
          status: projection.status,
          metadata: {
            requestId,
            workflowType: effectiveRequest.workflowType,
            blueprintId: command.input.blueprint?.blueprintId,
            reused: projection.reused === true,
          },
        });
      }

      await db
        .insert(idempotencyKeys)
        .values({
          organizationId: principal.organizationId,
          key: workflowId,
          requestHash: fingerprint,
          resourceType: "workflow",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .onConflictDoNothing();

      if (explicitIdempotencyKey && explicitIdempotencyKey !== workflowId) {
        await db
          .insert(idempotencyKeys)
          .values({
            organizationId: principal.organizationId,
            key: explicitIdempotencyKey,
            requestHash: fingerprint,
            resourceType: "workflow",
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          })
          .onConflictDoNothing();
      }

      return { ...projection, retentionUntil: retentionUntil.toISOString() };
    },
  );
}

export async function getWorkflow(
  principal: AosPrincipal,
  workflowId: string,
  options: WorkflowServiceOptions,
): Promise<WorkflowExecutionProjection | null> {
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRead)) {
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot read workflows.",
      );
    }
    return options.workflowClient.get(
      workflowId,
      principal.organizationId,
      options.namespace,
    );
  }

  const userId = localUserId(principal);
  if (!userId)
    throw workflowServiceError(
      "IDENTITY_NOT_RESOLVED",
      "The identity is not linked to a local user.",
    );

  const authorized = await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (!(await hasPermission(db, principal, Permission.WorkflowsRead))) {
        throw workflowServiceError(
          "FORBIDDEN",
          "The user cannot read workflows.",
        );
      }
      const [row] = await db
        .select({
          workflowId: workflowRuns.temporalWorkflowId,
          workflowType: workflowDefinitions.key,
          name: workflowRuns.name,
          blueprintId: workflowRuns.blueprintId,
          blueprintName: workflowBlueprints.name,
          blueprintVersion: workflowRuns.blueprintVersion,
          trigger: workflowRuns.trigger,
          namespace: workflowRuns.temporalNamespace,
          taskQueue: workflowRuns.temporalTaskQueue,
          status: workflowRuns.status,
          scope: workflowRuns.scope,
          retentionUntil: workflowRuns.retentionUntil,
          createdAt: workflowRuns.createdAt,
          updatedAt: workflowRuns.updatedAt,
        })
        .from(workflowRuns)
        .leftJoin(
          workflowDefinitions,
          eq(workflowDefinitions.id, workflowRuns.definitionId),
        )
        .leftJoin(
          workflowBlueprints,
          and(
            eq(workflowBlueprints.organizationId, workflowRuns.organizationId),
            eq(workflowBlueprints.blueprintId, workflowRuns.blueprintId),
            eq(workflowBlueprints.version, workflowRuns.blueprintVersion),
            isNull(workflowBlueprints.deletedAt),
          ),
        )
        .innerJoin(
          organizationMemberships,
          and(
            eq(
              organizationMemberships.organizationId,
              principal.organizationId,
            ),
            eq(organizationMemberships.userId, userId),
            eq(organizationMemberships.status, "active"),
          ),
        )
        .leftJoin(
          rolePermissions,
          eq(rolePermissions.roleId, organizationMemberships.roleId),
        )
        .where(
          and(
            eq(workflowRuns.organizationId, principal.organizationId),
            eq(workflowRuns.temporalWorkflowId, workflowId),
            or(
              isNull(workflowDefinitions.key),
              ne(workflowDefinitions.key, TemporalWorkflowType.Coordinator),
            ),
            or(
              eq(workflowRuns.actorUserId, userId),
              eq(rolePermissions.permission, Permission.WorkflowsRead),
              eq(rolePermissions.permission, Permission.WorkflowsManage),
            ),
          ),
        )
        .limit(1);
      return row && workflowScopeIsVisible(row.scope, principal.scope)
        ? row
        : null;
    },
  );

  if (!authorized) return null;
  const projection = await options.workflowClient.get(
    workflowId,
    principal.organizationId,
    options.namespace,
  );
  if (projection) {
    const synced = await syncWorkflowProjection(
      principal.organizationId,
      projection,
    );
    const scope = parseExecutionScope(authorized.scope);
    const decorated = {
      ...synced,
      ...(authorized.name ? { name: authorized.name } : {}),
      ...(authorized.blueprintName
        ? { blueprintName: authorized.blueprintName }
        : {}),
    };
    return scope ? { ...decorated, scope } : decorated;
  }
  const scope = parseExecutionScope(authorized.scope);
  if (
    (authorized.status === WorkflowExecutionStatus.Queued ||
      authorized.status === WorkflowExecutionStatus.Failed) &&
    authorized.workflowType &&
    authorized.namespace &&
    authorized.taskQueue
  )
    return {
      workflowId: authorized.workflowId,
      workflowType: authorized.workflowType,
      ...(authorized.name ? { name: authorized.name } : {}),
      ...(authorized.blueprintId
        ? { blueprintId: authorized.blueprintId }
        : {}),
      ...(authorized.blueprintName
        ? { blueprintName: authorized.blueprintName }
        : {}),
      ...(authorized.blueprintVersion
        ? { blueprintVersion: authorized.blueprintVersion }
        : {}),
      ...(authorized.trigger ? { trigger: authorized.trigger } : {}),
      namespace: authorized.namespace,
      taskQueue: authorized.taskQueue,
      status:
        authorized.status === WorkflowExecutionStatus.Failed
          ? WorkflowExecutionStatus.Failed
          : WorkflowExecutionStatus.Preparing,
      statusMessage:
        authorized.status === WorkflowExecutionStatus.Failed
          ? "The Coordinator could not prepare the Temporal workflow execution."
          : "The Coordinator is preparing the Temporal workflow execution.",
      organizationId: principal.organizationId,
      ...(scope ? { scope } : {}),
      ...(authorized.retentionUntil
        ? { retentionUntil: authorized.retentionUntil.toISOString() }
        : {}),
      createdAt: authorized.createdAt.toISOString(),
      updatedAt: authorized.updatedAt.toISOString(),
    };
  return null;
}

export async function getWorkflowEvents(
  principal: AosPrincipal,
  workflowId: string,
  options: WorkflowServiceOptions,
): Promise<readonly WorkflowEventProjection[] | null> {
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRead)) {
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot read workflows.",
      );
    }
    const workflow = await options.workflowClient.get(
      workflowId,
      principal.organizationId,
      options.namespace,
    );
    return workflow ? [] : null;
  }

  const userId = localUserId(principal);
  if (!userId)
    throw workflowServiceError(
      "IDENTITY_NOT_RESOLVED",
      "The identity is not linked to a local user.",
    );

  const run = await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (!(await hasPermission(db, principal, Permission.WorkflowsRead))) {
        throw workflowServiceError(
          "FORBIDDEN",
          "The user cannot read workflows.",
        );
      }
      const [row] = await db
        .select({
          runId: workflowRuns.id,
          temporalWorkflowId: workflowRuns.temporalWorkflowId,
          scope: workflowRuns.scope,
        })
        .from(workflowRuns)
        .leftJoin(
          workflowDefinitions,
          eq(workflowDefinitions.id, workflowRuns.definitionId),
        )
        .innerJoin(
          organizationMemberships,
          and(
            eq(
              organizationMemberships.organizationId,
              principal.organizationId,
            ),
            eq(organizationMemberships.userId, userId),
            eq(organizationMemberships.status, "active"),
          ),
        )
        .leftJoin(
          rolePermissions,
          eq(rolePermissions.roleId, organizationMemberships.roleId),
        )
        .where(
          and(
            eq(workflowRuns.organizationId, principal.organizationId),
            eq(workflowRuns.temporalWorkflowId, workflowId),
            or(
              isNull(workflowDefinitions.key),
              ne(workflowDefinitions.key, TemporalWorkflowType.Coordinator),
            ),
            or(
              eq(workflowRuns.actorUserId, userId),
              eq(rolePermissions.permission, Permission.WorkflowsRead),
              eq(rolePermissions.permission, Permission.WorkflowsManage),
            ),
          ),
        )
        .limit(1);
      return row && workflowScopeIsVisible(row.scope, principal.scope)
        ? row
        : null;
    },
  );

  if (!run) return null;

  const projection = await options.workflowClient
    .get(workflowId, principal.organizationId, options.namespace)
    .catch(() => null);
  if (
    projection &&
    new Set<WorkflowExecutionStatus>([
      WorkflowExecutionStatus.Completed,
      WorkflowExecutionStatus.Failed,
      WorkflowExecutionStatus.Partial,
      WorkflowExecutionStatus.Cancelled,
    ]).has(projection.status)
  ) {
    await projectRuntimeWorkflowResult(
      principal,
      run.runId,
      run.temporalWorkflowId,
      options,
      parseDate(projection.updatedAt) ?? new Date(),
    );
  }

  return withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      const rows = await db
        .select()
        .from(workflowEvents)
        .where(
          and(
            eq(workflowEvents.organizationId, principal.organizationId),
            eq(workflowEvents.workflowRunId, run.runId),
          ),
        )
        .orderBy(workflowEvents.occurredAt);
      return rows.map(
        workflowEventProjection,
      ) satisfies readonly WorkflowEventProjection[];
    },
  );
}

export async function listWorkflowActivity(
  principal: AosPrincipal,
  options: WorkflowServiceOptions,
  limit = 10,
): Promise<readonly WorkflowRecentActivityProjection[]> {
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRead)) {
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot read workflows.",
      );
    }
    return [];
  }

  const workflows = await listWorkflows(principal, options);
  if (workflows.length === 0) return [];
  const workflowIds = workflows.map((workflow) => workflow.workflowId);
  const workflowById = new Map(
    workflows.map((workflow) => [workflow.workflowId, workflow]),
  );

  return withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      const runs = await db
        .select({
          id: workflowRuns.id,
          workflowId: workflowRuns.temporalWorkflowId,
        })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.organizationId, principal.organizationId),
            inArray(workflowRuns.temporalWorkflowId, workflowIds),
          ),
        );
      if (runs.length === 0) return [];
      const runIds = runs.map((run) => run.id);
      const workflowByRunId = new Map(
        runs.map((run) => [run.id, run.workflowId]),
      );
      const rows = await db
        .select()
        .from(workflowEvents)
        .where(
          and(
            eq(workflowEvents.organizationId, principal.organizationId),
            inArray(workflowEvents.workflowRunId, runIds),
          ),
        )
        .orderBy(desc(workflowEvents.occurredAt))
        .limit(Math.max(1, Math.min(limit, 50)));
      return rows.map((row) => {
        const workflowId = workflowByRunId.get(row.workflowRunId) ?? "";
        const workflow = workflowById.get(workflowId);
        return {
          ...workflowEventProjection(row),
          workflowId,
          workflowLabel:
            workflow?.name ??
            workflow?.blueprintName ??
            workflow?.blueprintId ??
            workflow?.workflowType ??
            "Workflow",
        } satisfies WorkflowRecentActivityProjection;
      });
    },
  );
}

export async function listWorkflows(
  principal: AosPrincipal,
  options: WorkflowServiceOptions,
): Promise<readonly WorkflowExecutionProjection[]> {
  return listAllWorkflows(principal, options);
}

export async function listWorkflowsPage(
  principal: AosPrincipal,
  options: WorkflowServiceOptions,
  query: ListQuery,
): Promise<ListPage<WorkflowExecutionProjection>> {
  const workflows = await listAllWorkflows(principal, options);
  const normalizedQuery = query.query?.toLowerCase();
  const filtered = workflows.filter((workflow) => {
    if (query.status && workflow.status !== query.status) return false;
    if (!normalizedQuery) return true;
    return [
      workflow.workflowId,
      workflow.workflowType,
      workflow.name,
      workflow.blueprintId,
      workflow.blueprintName,
      workflow.status,
      workflow.statusMessage,
      workflow.trigger,
    ]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  const sorted = [...filtered].sort((left, right) => {
    if (query.sort === "updated-asc")
      return left.updatedAt.localeCompare(right.updatedAt);
    if (query.sort === "name-asc")
      return (
        left.name ??
        left.blueprintName ??
        left.blueprintId ??
        left.workflowType
      ).localeCompare(
        right.name ??
          right.blueprintName ??
          right.blueprintId ??
          right.workflowType,
      );
    if (query.sort === "status")
      return (
        left.status.localeCompare(right.status) ||
        right.updatedAt.localeCompare(left.updatedAt)
      );
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  return listPage(sorted, query);
}

async function listAllWorkflows(
  principal: AosPrincipal,
  options: WorkflowServiceOptions,
): Promise<readonly WorkflowExecutionProjection[]> {
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRead)) {
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot read workflows.",
      );
    }
    return options.workflowClient.list(
      principal.organizationId,
      options.namespace,
    );
  }

  const userId = localUserId(principal);
  if (!userId)
    throw workflowServiceError(
      "IDENTITY_NOT_RESOLVED",
      "The identity is not linked to a local user.",
    );

  const visible = await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (!(await hasPermission(db, principal, Permission.WorkflowsRead))) {
        throw workflowServiceError(
          "FORBIDDEN",
          "The user cannot read workflows.",
        );
      }
      const rows = await db
        .select({
          workflowId: workflowRuns.temporalWorkflowId,
          workflowType: workflowDefinitions.key,
          name: workflowRuns.name,
          blueprintId: workflowRuns.blueprintId,
          blueprintName: workflowBlueprints.name,
          blueprintVersion: workflowRuns.blueprintVersion,
          trigger: workflowRuns.trigger,
          namespace: workflowRuns.temporalNamespace,
          taskQueue: workflowRuns.temporalTaskQueue,
          status: workflowRuns.status,
          scope: workflowRuns.scope,
          retentionUntil: workflowRuns.retentionUntil,
          createdAt: workflowRuns.createdAt,
          updatedAt: workflowRuns.updatedAt,
        })
        .from(workflowRuns)
        .leftJoin(
          workflowDefinitions,
          eq(workflowDefinitions.id, workflowRuns.definitionId),
        )
        .leftJoin(
          workflowBlueprints,
          and(
            eq(workflowBlueprints.organizationId, workflowRuns.organizationId),
            eq(workflowBlueprints.blueprintId, workflowRuns.blueprintId),
            eq(workflowBlueprints.version, workflowRuns.blueprintVersion),
            isNull(workflowBlueprints.deletedAt),
          ),
        )
        .innerJoin(
          organizationMemberships,
          and(
            eq(
              organizationMemberships.organizationId,
              principal.organizationId,
            ),
            eq(organizationMemberships.userId, userId),
            eq(organizationMemberships.status, "active"),
          ),
        )
        .leftJoin(
          rolePermissions,
          eq(rolePermissions.roleId, organizationMemberships.roleId),
        )
        .where(
          and(
            eq(workflowRuns.organizationId, principal.organizationId),
            or(
              isNull(workflowDefinitions.key),
              ne(workflowDefinitions.key, TemporalWorkflowType.Coordinator),
            ),
            or(
              eq(workflowRuns.actorUserId, userId),
              eq(rolePermissions.permission, Permission.WorkflowsRead),
              eq(rolePermissions.permission, Permission.WorkflowsManage),
            ),
          ),
        );
      return [
        ...new Map(
          rows
            .filter((row) => workflowScopeIsVisible(row.scope, principal.scope))
            .map((row) => [row.workflowId, row] as const),
        ).values(),
      ];
    },
  );

  const projections = await options.workflowClient.list(
    principal.organizationId,
    options.namespace,
  );
  const visibleIds = new Set(visible.map((row) => row.workflowId));
  const visibleProjections = projections.filter((projection) =>
    visibleIds.has(projection.workflowId),
  );
  const temporalWorkflowIds = new Set(
    visibleProjections.map((projection) => projection.workflowId),
  );
  const synced = await Promise.all(
    visibleProjections.map(async (projection) => {
      const syncedProjection = await syncWorkflowProjection(
        principal.organizationId,
        projection,
      );
      const row = visible.find(
        (candidate) => candidate.workflowId === projection.workflowId,
      );
      return {
        ...syncedProjection,
        ...(row?.name ? { name: row.name } : {}),
        ...(row?.blueprintName ? { blueprintName: row.blueprintName } : {}),
      };
    }),
  );
  const preparing = visible.flatMap((row): WorkflowExecutionProjection[] => {
    if (
      temporalWorkflowIds.has(row.workflowId) ||
      (row.status !== WorkflowExecutionStatus.Queued &&
        row.status !== WorkflowExecutionStatus.Failed) ||
      !row.workflowType ||
      !row.namespace ||
      !row.taskQueue
    )
      return [];
    const scope = parseExecutionScope(row.scope);
    return [
      {
        workflowId: row.workflowId,
        workflowType: row.workflowType,
        ...(row.name ? { name: row.name } : {}),
        ...(row.blueprintId ? { blueprintId: row.blueprintId } : {}),
        ...(row.blueprintName ? { blueprintName: row.blueprintName } : {}),
        ...(row.blueprintVersion
          ? { blueprintVersion: row.blueprintVersion }
          : {}),
        ...(row.trigger ? { trigger: row.trigger } : {}),
        namespace: row.namespace,
        taskQueue: row.taskQueue,
        status:
          row.status === WorkflowExecutionStatus.Failed
            ? WorkflowExecutionStatus.Failed
            : WorkflowExecutionStatus.Preparing,
        statusMessage:
          row.status === WorkflowExecutionStatus.Failed
            ? "The Coordinator could not prepare the Temporal workflow execution."
            : "The Coordinator is preparing the Temporal workflow execution.",
        organizationId: principal.organizationId,
        ...(scope ? { scope } : {}),
        ...(row.retentionUntil
          ? { retentionUntil: row.retentionUntil.toISOString() }
          : {}),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    ];
  });
  return [...synced, ...preparing];
}

export async function signalWorkflow(
  principal: AosPrincipal,
  workflowId: string,
  request: WorkflowSignalRequest,
  options: WorkflowServiceOptions,
): Promise<void> {
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRun)) {
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot change this workflow state.",
      );
    }
  } else {
    const canRun = await withOrganizationContext(
      database,
      principal.organizationId,
      (db) => hasPermission(db, principal, Permission.WorkflowsRun),
    );
    if (!canRun)
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot change this workflow state.",
      );
  }

  const visible = await getWorkflow(principal, workflowId, options);
  if (!visible)
    throw workflowServiceError("WORKFLOW_NOT_FOUND", "Workflow not found.");
  if (
    visible.status !== "queued" &&
    visible.status !== "running" &&
    visible.status !== "waiting" &&
    visible.status !== "paused"
  ) {
    throw workflowServiceError(
      "WORKFLOW_NOT_SIGNALABLE",
      `Workflow is ${visible.status} and cannot accept a Signal.`,
    );
  }
  let effectiveRequest = request;
  if (request.signalName === "blueprint-approval") {
    if (!visible.pendingApprovalStepId) {
      throw workflowServiceError(
        "WORKFLOW_NOT_SIGNALABLE",
        "The active approval step is not available yet. Refresh the workflow and try again.",
      );
    }
    effectiveRequest = {
      ...request,
      payload: {
        ...request.payload,
        stepId: visible.pendingApprovalStepId,
      },
    };
  }
  let workflowRunId: string | undefined;
  if (database) {
    const userId = localUserId(principal);
    if (!userId)
      throw workflowServiceError(
        "IDENTITY_NOT_RESOLVED",
        "The identity is not linked to a local user.",
      );

    const canSignal = await withOrganizationContext(
      database,
      principal.organizationId,
      async (db) => {
        if (!(await hasPermission(db, principal, Permission.WorkflowsRun)))
          return null;
        const [row] = await db
          .select({
            workflowId: workflowRuns.temporalWorkflowId,
            workflowRunId: workflowRuns.id,
            scope: workflowRuns.scope,
          })
          .from(workflowRuns)
          .innerJoin(
            organizationMemberships,
            and(
              eq(
                organizationMemberships.organizationId,
                principal.organizationId,
              ),
              eq(organizationMemberships.userId, userId),
              eq(organizationMemberships.status, "active"),
            ),
          )
          .leftJoin(
            rolePermissions,
            eq(rolePermissions.roleId, organizationMemberships.roleId),
          )
          .where(
            and(
              eq(workflowRuns.organizationId, principal.organizationId),
              eq(workflowRuns.temporalWorkflowId, workflowId),
              or(
                eq(workflowRuns.actorUserId, userId),
                eq(rolePermissions.permission, Permission.WorkflowsRun),
                eq(rolePermissions.permission, Permission.WorkflowsManage),
              ),
            ),
          )
          .limit(1);
        return row && workflowScopeIsVisible(row.scope, principal.scope)
          ? row.workflowRunId
          : null;
      },
    );
    if (!canSignal)
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot change this workflow state.",
      );
    workflowRunId = canSignal;
  }

  const commandHash = workflowCommandHash(effectiveRequest);
  let commandClaim: WorkflowCommandClaim = "send";
  if (database && workflowRunId) {
    commandClaim = await withOrganizationContext(
      database,
      principal.organizationId,
      (db) =>
        claimWorkflowCommand(
          db,
          principal.organizationId,
          workflowRunId,
          workflowId,
          "signal",
          effectiveRequest.signalId,
          commandHash,
          "WORKFLOW_SIGNAL_CONFLICT",
        ),
    );
    if (commandClaim === "replay") return;
  }

  try {
    const runtimeRequest: WorkflowSignalRequest =
      effectiveRequest.signalName === "blueprint-approval"
        ? {
            ...effectiveRequest,
            payload: {
              ...effectiveRequest.payload,
              signalId: effectiveRequest.signalId,
            },
          }
        : {
            ...effectiveRequest,
            payload: {
              ...effectiveRequest.payload,
              signalId: effectiveRequest.signalId,
            },
          };
    await options.workflowClient.signal(
      workflowId,
      principal.organizationId,
      options.namespace,
      runtimeRequest,
    );
  } catch (error) {
    if (database && workflowRunId) {
      const message =
        error instanceof Error ? error.message : "Workflow Signal failed.";
      await withOrganizationContext(database, principal.organizationId, (db) =>
        markWorkflowCommandFailed(
          db,
          principal.organizationId,
          workflowId,
          "signal",
          effectiveRequest.signalId,
          message,
        ),
      ).catch(() => undefined);
    }
    throw error;
  }

  if (database && workflowRunId) {
    await withOrganizationContext(
      database,
      principal.organizationId,
      async (db) => {
        const controlStatus =
          effectiveRequest.signalName === "workflow-pause"
            ? WorkflowExecutionStatus.Paused
            : effectiveRequest.signalName === "workflow-resume"
              ? WorkflowExecutionStatus.Running
              : undefined;
        if (controlStatus) {
          await db
            .update(workflowRuns)
            .set({ status: controlStatus, updatedAt: new Date() })
            .where(
              and(
                eq(workflowRuns.organizationId, principal.organizationId),
                eq(workflowRuns.id, workflowRunId),
              ),
            );
        }
        await markWorkflowCommandAccepted(
          db,
          principal.organizationId,
          workflowId,
          "signal",
          effectiveRequest.signalId,
        );
        await db.insert(workflowEvents).values({
          organizationId: principal.organizationId,
          workflowRunId,
          eventType: "workflow_signal_sent",
          status: visible.status,
          metadata: {
            signalId: effectiveRequest.signalId,
            signalName: effectiveRequest.signalName,
            ...(effectiveRequest.signalName === "blueprint-approval"
              ? {
                  stepId: effectiveRequest.payload.stepId,
                  approved: effectiveRequest.payload.approved,
                }
              : {}),
            ...(effectiveRequest.signalName !== "blueprint-approval" &&
            effectiveRequest.payload.reason
              ? { reason: effectiveRequest.payload.reason }
              : {}),
            actorId: principal.actorId,
          },
        });
      },
    );
  }
}

export async function rerunWorkflow(
  principal: AosPrincipal,
  workflowId: string,
  requestId: string,
  traceId: string,
  options: WorkflowServiceOptions,
): Promise<WorkflowExecutionProjection> {
  if (!database)
    throw workflowServiceError(
      "DATABASE_UNAVAILABLE",
      "Run again requires persisted workflow history.",
    );
  const userId = localUserId(principal);
  if (!userId)
    throw workflowServiceError(
      "IDENTITY_NOT_RESOLVED",
      "The identity is not linked to a local user.",
    );
  const canRun = await withOrganizationContext(
    database,
    principal.organizationId,
    (db) => hasPermission(db, principal, Permission.WorkflowsRun),
  );
  if (!canRun)
    throw workflowServiceError(
      "FORBIDDEN",
      "The user cannot run workflows again.",
    );

  const previous = await getWorkflow(principal, workflowId, options);
  if (!previous)
    throw workflowServiceError("WORKFLOW_NOT_FOUND", "Workflow not found.");
  const rerunnableStatuses: readonly WorkflowExecutionStatus[] = [
    WorkflowExecutionStatus.Completed,
    WorkflowExecutionStatus.Failed,
    WorkflowExecutionStatus.Cancelled,
  ];
  if (!rerunnableStatuses.includes(previous.status)) {
    throw workflowServiceError(
      "WORKFLOW_NOT_RERUNNABLE",
      `Workflow is ${previous.status} and cannot be run again.`,
    );
  }

  const source = await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      const [row] = await db
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.organizationId, principal.organizationId),
            eq(workflowRuns.temporalWorkflowId, workflowId),
          ),
        )
        .limit(1);
      if (!row || !workflowScopeIsVisible(row.scope, principal.scope))
        return null;
      const blueprintId = row.blueprintId ?? row.inputRef;
      if (!blueprintId || !row.blueprintVersion)
        throw workflowServiceError(
          "WORKFLOW_REVISION_UNAVAILABLE",
          "The original Blueprint revision is not stored for this run.",
        );
      const scope =
        isJsonObject(row.scope) &&
        Array.isArray(row.scope.ids) &&
        row.scope.ids.every((id) => typeof id === "string")
          ? { ids: row.scope.ids as string[] }
          : null;
      if (!scope)
        throw workflowServiceError(
          "WORKFLOW_SCOPE_UNAVAILABLE",
          "The original execution scope is not available for this run.",
        );
      const [blueprintRow] = await db
        .select({
          blueprint: workflowBlueprints.blueprint,
          status: workflowBlueprints.status,
        })
        .from(workflowBlueprints)
        .where(
          and(
            eq(workflowBlueprints.organizationId, principal.organizationId),
            eq(workflowBlueprints.blueprintId, blueprintId),
            eq(workflowBlueprints.version, row.blueprintVersion),
            isNull(workflowBlueprints.deletedAt),
          ),
        )
        .limit(1);
      if (blueprintRow?.status !== "approved")
        throw workflowServiceError(
          "WORKFLOW_REVISION_UNAVAILABLE",
          "The original approved Blueprint revision is no longer available.",
        );
      const businessInput = isJsonObject(row.businessInput)
        ? row.businessInput
        : {};
      return {
        blueprintId,
        blueprintVersion: row.blueprintVersion,
        scope,
        businessInput,
      };
    },
  );
  if (!source)
    throw workflowServiceError(
      "FORBIDDEN",
      "The user cannot run this workflow again in the current scope.",
    );

  const projection = await startWorkflow(
    principal,
    {
      workflowType: TemporalWorkflowType.Dynamic,
      version: "v1",
      key: `rerun-${randomUUID()}`,
      blueprintId: source.blueprintId,
      blueprintVersion: source.blueprintVersion,
      scope: source.scope,
      input: { businessInput: source.businessInput },
    },
    requestId,
    traceId,
    options,
    { parentWorkflowId: workflowId, trigger: "rerun" },
  );

  await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      await db.insert(auditEvents).values({
        organizationId: principal.organizationId,
        actorUserId: userId,
        action: "workflow.rerun.started",
        outcome: "accepted",
        resourceType: "workflow_run",
        resourceId: projection.workflowId,
        scope: source.scope,
        metadata: {
          parentWorkflowId: workflowId,
          blueprintId: source.blueprintId,
          blueprintVersion: source.blueprintVersion,
        },
      });
    },
  );
  return projection;
}

export async function cancelWorkflow(
  principal: AosPrincipal,
  workflowId: string,
  options: WorkflowServiceOptions,
): Promise<void> {
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRun))
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot cancel this workflow.",
      );
  } else {
    const canRun = await withOrganizationContext(
      database,
      principal.organizationId,
      (db) => hasPermission(db, principal, Permission.WorkflowsRun),
    );
    if (!canRun)
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot cancel this workflow.",
      );
  }

  const visible = await getWorkflow(principal, workflowId, options);
  if (!visible)
    throw workflowServiceError("WORKFLOW_NOT_FOUND", "Workflow not found.");
  if (!["queued", "running", "waiting", "paused"].includes(visible.status)) {
    throw workflowServiceError(
      "WORKFLOW_NOT_CANCELLABLE",
      `Workflow is ${visible.status} and cannot be cancelled.`,
    );
  }

  let workflowRunId: string | undefined;
  if (database) {
    const userId = localUserId(principal);
    if (!userId)
      throw workflowServiceError(
        "IDENTITY_NOT_RESOLVED",
        "The identity is not linked to a local user.",
      );
    workflowRunId = await withOrganizationContext(
      database,
      principal.organizationId,
      async (db) => {
        const [row] = await db
          .select({ workflowRunId: workflowRuns.id, scope: workflowRuns.scope })
          .from(workflowRuns)
          .innerJoin(
            organizationMemberships,
            and(
              eq(
                organizationMemberships.organizationId,
                principal.organizationId,
              ),
              eq(organizationMemberships.userId, userId),
              eq(organizationMemberships.status, "active"),
            ),
          )
          .leftJoin(
            rolePermissions,
            eq(rolePermissions.roleId, organizationMemberships.roleId),
          )
          .where(
            and(
              eq(workflowRuns.organizationId, principal.organizationId),
              eq(workflowRuns.temporalWorkflowId, workflowId),
              or(
                eq(workflowRuns.actorUserId, userId),
                eq(rolePermissions.permission, Permission.WorkflowsRun),
                eq(rolePermissions.permission, Permission.WorkflowsManage),
              ),
            ),
          )
          .limit(1);
        return row && workflowScopeIsVisible(row.scope, principal.scope)
          ? row.workflowRunId
          : undefined;
      },
    );
    if (!workflowRunId)
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot cancel this workflow.",
      );
  }

  try {
    await options.workflowClient.cancel(
      workflowId,
      principal.organizationId,
      options.namespace,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Workflow cancellation failed.";
    if (message.includes("not found"))
      throw workflowServiceError("WORKFLOW_NOT_FOUND", "Workflow not found.");
    if (message.includes("cannot be cancelled"))
      throw workflowServiceError("WORKFLOW_NOT_CANCELLABLE", message);
    throw workflowServiceError("WORKFLOW_CANCEL_FAILED", message);
  }

  if (database && workflowRunId) {
    await withOrganizationContext(database, principal.organizationId, (db) =>
      db.insert(workflowEvents).values({
        organizationId: principal.organizationId,
        workflowRunId,
        eventType: "workflow_cancel_requested",
        status: visible.status,
        metadata: { actorId: principal.actorId, reason: "user_requested" },
      }),
    );
  }
}

export async function updateWorkflow(
  principal: AosPrincipal,
  workflowId: string,
  request: WorkflowUpdateRequest,
  options: WorkflowServiceOptions,
): Promise<void> {
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRun)) {
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot update this workflow.",
      );
    }
  } else {
    const canRun = await withOrganizationContext(
      database,
      principal.organizationId,
      (db) => hasPermission(db, principal, Permission.WorkflowsRun),
    );
    if (!canRun)
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot update this workflow.",
      );
  }

  const visible = await getWorkflow(principal, workflowId, options);
  if (!visible)
    throw workflowServiceError("WORKFLOW_NOT_FOUND", "Workflow not found.");
  if (
    visible.status !== "queued" &&
    visible.status !== "running" &&
    visible.status !== "waiting"
  ) {
    throw workflowServiceError(
      "WORKFLOW_NOT_UPDATABLE",
      `Workflow is ${visible.status} and cannot accept an Update.`,
    );
  }
  let workflowRunId: string | undefined;
  if (database) {
    const userId = localUserId(principal);
    if (!userId)
      throw workflowServiceError(
        "IDENTITY_NOT_RESOLVED",
        "The identity is not linked to a local user.",
      );

    workflowRunId = await withOrganizationContext(
      database,
      principal.organizationId,
      async (db) => {
        if (!(await hasPermission(db, principal, Permission.WorkflowsRun)))
          return undefined;
        const [row] = await db
          .select({ workflowRunId: workflowRuns.id })
          .from(workflowRuns)
          .innerJoin(
            organizationMemberships,
            and(
              eq(
                organizationMemberships.organizationId,
                principal.organizationId,
              ),
              eq(organizationMemberships.userId, userId),
              eq(organizationMemberships.status, "active"),
            ),
          )
          .leftJoin(
            rolePermissions,
            eq(rolePermissions.roleId, organizationMemberships.roleId),
          )
          .where(
            and(
              eq(workflowRuns.organizationId, principal.organizationId),
              eq(workflowRuns.temporalWorkflowId, workflowId),
              or(
                eq(workflowRuns.actorUserId, userId),
                eq(rolePermissions.permission, Permission.WorkflowsRun),
                eq(rolePermissions.permission, Permission.WorkflowsManage),
              ),
            ),
          )
          .limit(1);
        return row?.workflowRunId;
      },
    );
    if (!workflowRunId)
      throw workflowServiceError(
        "FORBIDDEN",
        "The user cannot update this workflow.",
      );
  }

  const commandHash = workflowCommandHash(request);
  let commandClaim: WorkflowCommandClaim = "send";
  if (database && workflowRunId) {
    commandClaim = await withOrganizationContext(
      database,
      principal.organizationId,
      (db) =>
        claimWorkflowCommand(
          db,
          principal.organizationId,
          workflowRunId,
          workflowId,
          "update",
          request.updateId,
          commandHash,
          "WORKFLOW_UPDATE_CONFLICT",
        ),
    );
    if (commandClaim === "replay") return;
  }

  try {
    await options.workflowClient.update(
      workflowId,
      principal.organizationId,
      options.namespace,
      request,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Workflow Update failed.";
    if (database && workflowRunId) {
      await withOrganizationContext(database, principal.organizationId, (db) =>
        markWorkflowCommandFailed(
          db,
          principal.organizationId,
          workflowId,
          "update",
          request.updateId,
          message,
        ),
      ).catch(() => undefined);
    }
    if (message.includes("not found"))
      throw workflowServiceError("WORKFLOW_NOT_FOUND", "Workflow not found.");
    if (message.includes("cannot accept"))
      throw workflowServiceError("WORKFLOW_NOT_UPDATABLE", message);
    if (message.includes("idempotency conflict"))
      throw workflowServiceError(
        "WORKFLOW_UPDATE_CONFLICT",
        "The Update ID already belongs to a different payload.",
      );
    throw workflowServiceError("WORKFLOW_UPDATE_FAILED", message);
  }

  if (database && workflowRunId) {
    await withOrganizationContext(
      database,
      principal.organizationId,
      async (db) => {
        await markWorkflowCommandAccepted(
          db,
          principal.organizationId,
          workflowId,
          "update",
          request.updateId,
        );
        await db.insert(workflowEvents).values({
          organizationId: principal.organizationId,
          workflowRunId,
          eventType: "workflow_context_updated",
          status: visible.status,
          metadata: {
            updateId: request.updateId,
            updateName: request.updateName,
            reason: request.payload.reason,
            actorId: principal.actorId,
            updatedKeys: Object.keys(request.payload.businessInput),
          },
        });
      },
    );
  }
}
