import { and, eq, isNull, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { ContractVersion, parseWorkflowBlueprint, TemporalWorkflowType } from "@encois/contracts";
import type {
  ExecutionScope,
  JsonObject,
  WorkflowBlueprint,
  WorkflowChangePlan,
  WorkflowChangePlanV2,
} from "@encois/contracts";
import {
  organizationMemberships,
  rolePermissions,
  workflowBlueprints,
  workflowDefinitions,
  idempotencyKeys,
  workflowCommandReceipts,
  workflowEvents,
  workflowRuns,
  type PersistenceTransaction,
  withOrganizationContext,
} from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { database } from "../../database.js";
import type { WorkflowClient } from "../temporal-client.js";
import {
  buildWorkflowId,
  type WorkflowExecutionProjection,
  type WorkflowSignalRequest,
  type WorkflowStartRequest,
  type WorkflowUpdateRequest,
} from "../types.js";

export type WorkflowServiceOptions = {
  workflowClient: WorkflowClient;
  policyVersion: string;
  namespace: string;
  taskQueue: string;
};

export type WorkflowServiceError = Error & {
  code: string;
};

export type WorkflowChangePlanInput = WorkflowChangePlan | WorkflowChangePlanV2;

export function workflowServiceError(code: string, message: string): WorkflowServiceError {
  const error = new Error(message) as WorkflowServiceError;
  error.code = code;
  return error;
}

export function isWorkflowServiceError(error: unknown): error is WorkflowServiceError {
  return error instanceof Error && typeof (error as Partial<WorkflowServiceError>).code === "string";
}

export function localUserId(principal: AosPrincipal): string | null {
  const candidate = principal.userId ?? principal.actorId;
  return /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null;
}

function blueprintFromPayload(payload: JsonObject): WorkflowBlueprint | undefined {
  if (isRecord(payload.blueprint)) return parseWorkflowBlueprint(payload.blueprint) ?? undefined;
  if (payload.workflowType === TemporalWorkflowType.UserBlueprint && Array.isArray(payload.steps)) {
    return parseWorkflowBlueprint(payload) ?? undefined;
  }
  return undefined;
}

function getBlueprint(request: WorkflowStartRequest, payload: JsonObject): WorkflowBlueprint | undefined {
  if (request.workflowType !== TemporalWorkflowType.UserBlueprint) return undefined;
  return request.blueprint ?? blueprintFromPayload(payload);
}

function getBusinessInput(request: WorkflowStartRequest, payload: JsonObject): JsonObject {
  if (isRecord(payload.businessInput)) return payload.businessInput;
  if (!request.blueprint) return payload;
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "blueprint"));
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
) {
  const payload = request.input ?? {};
  const blueprint = getBlueprint(request, payload);
  const businessInput = getBusinessInput(request, payload);
  const scope: ExecutionScope = {
    ids: principal.scope,
    ...(request.scope?.projectIds ? { projectIds: request.scope.projectIds } : {}),
    ...(request.scope?.teamIds ? { teamIds: request.scope.teamIds } : {}),
  };
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
      userId: principal.userId,
      blueprint,
      businessInput: businessInput as JsonObject,
      payload: payload as JsonObject,
      idempotencyKey: request.idempotencyKey,
    },
    requestHash,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

type WorkflowCommandType = "signal" | "update";

type WorkflowCommandClaim = "send" | "replay";

function workflowCommandHash(request: WorkflowSignalRequest | WorkflowUpdateRequest): string {
  return createHash("sha256").update(stableSerialize(request)).digest("hex");
}

async function claimWorkflowCommand(
  db: PersistenceTransaction,
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
    .select({ requestHash: workflowCommandReceipts.requestHash, status: workflowCommandReceipts.status })
    .from(workflowCommandReceipts)
    .where(where)
    .limit(1);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw workflowServiceError(conflictCode, `The ${commandType} ID already belongs to a different payload.`);
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
    .select({ requestHash: workflowCommandReceipts.requestHash, status: workflowCommandReceipts.status })
    .from(workflowCommandReceipts)
    .where(where)
    .limit(1);
  if (!raced) throw workflowServiceError("WORKFLOW_COMMAND_RECEIPT_FAILED", "The workflow command receipt could not be claimed.");
  if (raced.requestHash !== requestHash) {
    throw workflowServiceError(conflictCode, `The ${commandType} ID already belongs to a different payload.`);
  }
  return raced.status === "accepted" ? "replay" : "send";
}

async function markWorkflowCommandFailed(
  db: PersistenceTransaction,
  organizationId: string,
  workflowId: string,
  commandType: WorkflowCommandType,
  commandId: string,
  error: string,
): Promise<void> {
  await db
    .update(workflowCommandReceipts)
    .set({ status: "failed", error: error.slice(0, 2000), updatedAt: new Date() })
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
  db: PersistenceTransaction,
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
  db: PersistenceTransaction,
  organizationId: string,
  request: WorkflowStartRequest,
): Promise<WorkflowStartRequest> {
  if (request.blueprint || !request.blueprintId) return request;
  if (!request.blueprintVersion) {
    throw workflowServiceError("BLUEPRINT_VERSION_REQUIRED", "blueprintVersion is required when starting a stored Blueprint.");
  }

  const [row] = await db
    .select({ blueprint: workflowBlueprints.blueprint, status: workflowBlueprints.status })
    .from(workflowBlueprints)
    .where(
      and(
        eq(workflowBlueprints.organizationId, organizationId),
        eq(workflowBlueprints.blueprintId, request.blueprintId),
        eq(workflowBlueprints.version, request.blueprintVersion),
      ),
    )
    .limit(1);
  if (!row || row.status !== "approved") {
    throw workflowServiceError("BLUEPRINT_NOT_FOUND", "The requested approved Blueprint snapshot was not found.");
  }
  const blueprint = parseWorkflowBlueprint(row.blueprint);
  if (!blueprint) throw workflowServiceError("BLUEPRINT_INVALID", "The stored Blueprint snapshot is invalid.");
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

async function syncWorkflowProjection(
  organizationId: string,
  projection: WorkflowExecutionProjection,
): Promise<void> {
  if (!database) return;

  await withOrganizationContext(database, organizationId, async (db) => {
    const [run] = await db
      .select({ id: workflowRuns.id, status: workflowRuns.status })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.organizationId, organizationId),
          eq(workflowRuns.temporalWorkflowId, projection.workflowId),
        ),
      )
      .limit(1);
    if (!run) return;

    const updatedAt = parseDate(projection.updatedAt) ?? new Date();
    const startedAt = parseDate(projection.createdAt);
    const completedAt = ["completed", "failed", "cancelled"].includes(projection.status) ? updatedAt : undefined;
    await db
      .update(workflowRuns)
      .set({
        status: projection.status,
        temporalRunId: projection.runId,
        ...(startedAt ? { startedAt } : {}),
        ...(completedAt ? { completedAt } : {}),
        updatedAt,
      })
      .where(eq(workflowRuns.id, run.id));

    if (run.status !== projection.status) {
      await db.insert(workflowEvents).values({
        organizationId,
        workflowRunId: run.id,
        eventType: "workflow_status_updated",
        status: projection.status,
        metadata: {
          source: "temporal_visibility",
          previousStatus: run.status,
          runId: projection.runId,
        },
        occurredAt: updatedAt,
      });
    }
  });
}

export async function startWorkflow(
  principal: AosPrincipal,
  request: WorkflowStartRequest,
  requestId: string,
  traceId: string,
  options: WorkflowServiceOptions,
): Promise<WorkflowExecutionProjection> {
  const workflowId = buildWorkflowId({
    organizationId: principal.organizationId,
    workflowType: request.workflowType,
    key: request.key ?? request.idempotencyKey ?? requestId,
  });
  const fingerprint = requestHash(request);

  if (!database) {
    if (request.blueprintId && !request.blueprint) {
      throw workflowServiceError("BLUEPRINT_REGISTRY_UNAVAILABLE", "A stored Blueprint requires configured persistence.");
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
        ),
        options.namespace,
      );
    } catch (error) {
      if (isIdempotencyConflict(error)) {
        throw workflowServiceError("IDEMPOTENCY_CONFLICT", "The workflow key already belongs to a different request.");
      }
      throw error;
    }
  }

  const userId = localUserId(principal);
  if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const [permission] = await db
      .select({ membershipId: organizationMemberships.id })
      .from(organizationMemberships)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, organizationMemberships.roleId))
      .where(
        and(
          eq(organizationMemberships.organizationId, principal.organizationId),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, "active"),
          or(eq(rolePermissions.permission, "workflows:run"), eq(rolePermissions.permission, "workflows:manage")),
        ),
      );
    if (!permission) throw workflowServiceError("FORBIDDEN", "The user cannot start workflows.");

    const [workflowIdentity] = await db
      .select({ requestHash: idempotencyKeys.requestHash })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.organizationId, principal.organizationId), eq(idempotencyKeys.key, workflowId)))
      .limit(1);
    if (workflowIdentity && workflowIdentity.requestHash !== fingerprint) {
      throw workflowServiceError("IDEMPOTENCY_CONFLICT", "The workflow key already belongs to a different request.");
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
      if (existingIdempotency && existingIdempotency.requestHash !== fingerprint) {
        throw workflowServiceError("IDEMPOTENCY_CONFLICT", "The idempotency key already belongs to a different request.");
      }
    }

    const [existingRun] = await db
      .select({ workflowId: workflowRuns.temporalWorkflowId })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.organizationId, principal.organizationId),
          eq(workflowRuns.temporalWorkflowId, workflowId),
        ),
      )
      .limit(1);
    if (existingRun) {
      const existingProjection = await options.workflowClient.get(workflowId, principal.organizationId, options.namespace);
      if (existingProjection) return { ...existingProjection, reused: true };
      throw workflowServiceError("WORKFLOW_PROJECTION_MISSING", "The active workflow projection is unavailable.");
    }

    const effectiveRequest = await resolveStoredBlueprint(db, principal.organizationId, request);
    const version = effectiveRequest.version ?? "v1";
    const [definition] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.key, effectiveRequest.workflowType),
          eq(workflowDefinitions.version, version),
          eq(workflowDefinitions.status, "approved"),
          or(isNull(workflowDefinitions.organizationId), eq(workflowDefinitions.organizationId, principal.organizationId)),
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
    );
    const projection = await options.workflowClient.start(command, options.namespace);

    const [workflowRun] = await db
      .insert(workflowRuns)
      .values({
        organizationId: principal.organizationId,
        definitionId: definition.id,
        actorUserId: userId,
        temporalNamespace: projection.namespace,
        temporalTaskQueue: projection.taskQueue,
        temporalWorkflowId: projection.workflowId,
        temporalRunId: projection.runId,
        status: projection.status,
        scope: command.input.scope,
      })
      .returning({ id: workflowRuns.id });

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

    return projection;
  });
}

export async function getWorkflow(
  principal: AosPrincipal,
  workflowId: string,
  options: WorkflowServiceOptions,
): Promise<WorkflowExecutionProjection | null> {
  if (!database) return options.workflowClient.get(workflowId, principal.organizationId, options.namespace);

  const userId = localUserId(principal);
  if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");

  const authorized = await withOrganizationContext(database, principal.organizationId, async (db) => {
    const [row] = await db
      .select({ workflowId: workflowRuns.temporalWorkflowId })
      .from(workflowRuns)
      .innerJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.organizationId, principal.organizationId),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, "active"),
        ),
      )
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, organizationMemberships.roleId))
      .where(
        and(
          eq(workflowRuns.organizationId, principal.organizationId),
          eq(workflowRuns.temporalWorkflowId, workflowId),
          or(
            eq(workflowRuns.actorUserId, userId),
            eq(rolePermissions.permission, "workflows:read"),
            eq(rolePermissions.permission, "workflows:manage"),
          ),
        ),
      )
      .limit(1);
    return row?.workflowId ?? null;
  });

  if (!authorized) return null;
  const projection = await options.workflowClient.get(workflowId, principal.organizationId, options.namespace);
  if (projection) await syncWorkflowProjection(principal.organizationId, projection);
  return projection;
}

export async function listWorkflows(
  principal: AosPrincipal,
  options: WorkflowServiceOptions,
): Promise<readonly WorkflowExecutionProjection[]> {
  if (!database) return options.workflowClient.list(principal.organizationId, options.namespace);

  const userId = localUserId(principal);
  if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");

  const visible = await withOrganizationContext(database, principal.organizationId, async (db) => {
    const rows = await db
      .select({ workflowId: workflowRuns.temporalWorkflowId })
      .from(workflowRuns)
      .innerJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.organizationId, principal.organizationId),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, "active"),
        ),
      )
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, organizationMemberships.roleId))
      .where(
        and(
          eq(workflowRuns.organizationId, principal.organizationId),
          or(
            eq(workflowRuns.actorUserId, userId),
            eq(rolePermissions.permission, "workflows:read"),
            eq(rolePermissions.permission, "workflows:manage"),
          ),
        ),
      );
    return new Set(rows.map((row) => row.workflowId));
  });

  const projections = await options.workflowClient.list(principal.organizationId, options.namespace);
  const visibleProjections = projections.filter((projection) => visible.has(projection.workflowId));
  await Promise.all(visibleProjections.map((projection) => syncWorkflowProjection(principal.organizationId, projection)));
  return visibleProjections;
}

export async function signalWorkflow(
  principal: AosPrincipal,
  workflowId: string,
  request: WorkflowSignalRequest,
  options: WorkflowServiceOptions,
): Promise<void> {
  const visible = await getWorkflow(principal, workflowId, options);
  if (!visible) throw workflowServiceError("WORKFLOW_NOT_FOUND", "Workflow not found.");
  if (visible.status !== "queued" && visible.status !== "running" && visible.status !== "waiting") {
    throw workflowServiceError(
      "WORKFLOW_NOT_SIGNALABLE",
      `Workflow is ${visible.status} and cannot accept a Signal.`,
    );
  }

  let workflowRunId: string | undefined;
  if (database) {
    const userId = localUserId(principal);
    if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");

    const canSignal = await withOrganizationContext(database, principal.organizationId, async (db) => {
      const [row] = await db
        .select({ workflowId: workflowRuns.temporalWorkflowId, workflowRunId: workflowRuns.id })
        .from(workflowRuns)
        .innerJoin(
          organizationMemberships,
          and(
            eq(organizationMemberships.organizationId, principal.organizationId),
            eq(organizationMemberships.userId, userId),
            eq(organizationMemberships.status, "active"),
          ),
        )
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, organizationMemberships.roleId))
        .where(
          and(
            eq(workflowRuns.organizationId, principal.organizationId),
            eq(workflowRuns.temporalWorkflowId, workflowId),
            or(
              eq(workflowRuns.actorUserId, userId),
              eq(rolePermissions.permission, "workflows:run"),
              eq(rolePermissions.permission, "workflows:manage"),
            ),
          ),
        )
        .limit(1);
      return row?.workflowRunId ?? null;
    });
    if (!canSignal) throw workflowServiceError("FORBIDDEN", "The user cannot change this workflow state.");
    workflowRunId = canSignal;
  }

  const commandHash = workflowCommandHash(request);
  let commandClaim: WorkflowCommandClaim = "send";
  if (database && workflowRunId) {
    commandClaim = await withOrganizationContext(database, principal.organizationId, (db) =>
      claimWorkflowCommand(
        db,
        principal.organizationId,
        workflowRunId,
        workflowId,
        "signal",
        request.signalId,
        commandHash,
        "WORKFLOW_SIGNAL_CONFLICT",
      ),
    );
    if (commandClaim === "replay") return;
  }

  try {
    await options.workflowClient.signal(workflowId, principal.organizationId, options.namespace, {
      ...request,
      payload: { ...request.payload, signalId: request.signalId },
    });
  } catch (error) {
    if (database && workflowRunId) {
      const message = error instanceof Error ? error.message : "Workflow Signal failed.";
      await withOrganizationContext(database, principal.organizationId, (db) =>
        markWorkflowCommandFailed(db, principal.organizationId, workflowId, "signal", request.signalId, message),
      ).catch(() => undefined);
    }
    throw error;
  }

  if (database && workflowRunId) {
    await withOrganizationContext(database, principal.organizationId, async (db) => {
      await markWorkflowCommandAccepted(db, principal.organizationId, workflowId, "signal", request.signalId);
      await db.insert(workflowEvents).values({
        organizationId: principal.organizationId,
        workflowRunId,
        eventType: "workflow_signal_sent",
        status: visible.status,
        metadata: {
          signalId: request.signalId,
          signalName: request.signalName,
          stepId: request.payload.stepId,
          approved: request.payload.approved,
          actorId: principal.actorId,
        },
      });
    });
  }
}

export async function updateWorkflow(
  principal: AosPrincipal,
  workflowId: string,
  request: WorkflowUpdateRequest,
  options: WorkflowServiceOptions,
): Promise<void> {
  const visible = await getWorkflow(principal, workflowId, options);
  if (!visible) throw workflowServiceError("WORKFLOW_NOT_FOUND", "Workflow not found.");
  if (visible.status !== "queued" && visible.status !== "running" && visible.status !== "waiting") {
    throw workflowServiceError(
      "WORKFLOW_NOT_UPDATABLE",
      `Workflow is ${visible.status} and cannot accept an Update.`,
    );
  }

  let workflowRunId: string | undefined;
  if (database) {
    const userId = localUserId(principal);
    if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");

    workflowRunId = await withOrganizationContext(database, principal.organizationId, async (db) => {
      const [row] = await db
        .select({ workflowRunId: workflowRuns.id })
        .from(workflowRuns)
        .innerJoin(
          organizationMemberships,
          and(
            eq(organizationMemberships.organizationId, principal.organizationId),
            eq(organizationMemberships.userId, userId),
            eq(organizationMemberships.status, "active"),
          ),
        )
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, organizationMemberships.roleId))
        .where(
          and(
            eq(workflowRuns.organizationId, principal.organizationId),
            eq(workflowRuns.temporalWorkflowId, workflowId),
            or(
              eq(workflowRuns.actorUserId, userId),
              eq(rolePermissions.permission, "workflows:run"),
              eq(rolePermissions.permission, "workflows:manage"),
            ),
          ),
        )
        .limit(1);
      return row?.workflowRunId;
    });
    if (!workflowRunId) throw workflowServiceError("FORBIDDEN", "The user cannot update this workflow.");
  }

  const commandHash = workflowCommandHash(request);
  let commandClaim: WorkflowCommandClaim = "send";
  if (database && workflowRunId) {
    commandClaim = await withOrganizationContext(database, principal.organizationId, (db) =>
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
    await options.workflowClient.update(workflowId, principal.organizationId, options.namespace, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow Update failed.";
    if (database && workflowRunId) {
      await withOrganizationContext(database, principal.organizationId, (db) =>
        markWorkflowCommandFailed(db, principal.organizationId, workflowId, "update", request.updateId, message),
      ).catch(() => undefined);
    }
    if (message.includes("not found")) throw workflowServiceError("WORKFLOW_NOT_FOUND", "Workflow not found.");
    if (message.includes("cannot accept")) throw workflowServiceError("WORKFLOW_NOT_UPDATABLE", message);
    if (message.includes("idempotency conflict")) throw workflowServiceError("WORKFLOW_UPDATE_CONFLICT", "The Update ID already belongs to a different payload.");
    throw workflowServiceError("WORKFLOW_UPDATE_FAILED", message);
  }

  if (database && workflowRunId) {
    await withOrganizationContext(database, principal.organizationId, async (db) => {
      await markWorkflowCommandAccepted(db, principal.organizationId, workflowId, "update", request.updateId);
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
    });
  }
}

export type WorkflowPlanValidationResult = {
  planId: string;
  organizationId: string;
  changeCount: number;
  approvalRequired: boolean;
  status: "validated_not_applied";
  applyStatus: "deferred_persistence_and_approval";
};

/**
 * Validate a model- or user-proposed plan without applying it. Persistence,
 * human approval, and Blueprint revision application are deliberately separate
 * steps so a proposal can never mutate the registry by accident.
 */
export async function validateWorkflowChangePlan(
  principal: AosPrincipal,
  plan: WorkflowChangePlanInput,
): Promise<WorkflowPlanValidationResult> {
  if (plan.organizationId !== principal.organizationId) {
    throw workflowServiceError("FORBIDDEN", "The workflow plan belongs to a different organization.");
  }

  const requiredScopes = new Set(
    plan.changes.flatMap((change) => (change.blueprint?.requiredScopes ? [...change.blueprint.requiredScopes] : [])),
  );
  const missingScope = [...requiredScopes].find((scope) => !principal.scope.includes(scope));
  if (missingScope) {
    throw workflowServiceError("SCOPE_DENIED", `The current identity is missing required scope ${missingScope}.`);
  }

  for (const [index, change] of plan.changes.entries()) {
    if (!change.start) continue;
    if (change.kind !== "create" && change.kind !== "update") {
      throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} cannot start a non-executable change.`);
    }
    if (!change.blueprint || !change.start.key) {
      throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} has an incomplete start intent.`);
    }
  }

  if (plan.contractVersion === ContractVersion.WorkflowChangePlanV2) {
    for (const [index, change] of plan.changes.entries()) {
      if (change.kind === "update") {
        if (!change.targetBlueprintId || !change.targetBlueprintVersion || !change.blueprint) {
          throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} requires a Blueprint target and replacement.`);
        }
        if (change.targetWorkflowId) {
          throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} cannot target a Temporal execution.`);
        }
        if (change.blueprint.blueprintId !== change.targetBlueprintId) {
          throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} targets a different Blueprint id.`);
        }
        if (change.blueprint.version === change.targetBlueprintVersion) {
          throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} must publish a new Blueprint version.`);
        }
      } else if (change.kind === "deprecate") {
        if (!change.targetBlueprintId || !change.targetBlueprintVersion) {
          throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} requires a Blueprint target.`);
        }
        if (change.targetWorkflowId) {
          throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} cannot target a Temporal execution.`);
        }
      } else if (change.kind === "cancel") {
        if (!change.targetWorkflowId) {
          throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} requires a Temporal workflow target.`);
        }
        if (change.targetBlueprintId || change.targetBlueprintVersion || change.blueprint) {
          throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} cannot target a Blueprint registry object.`);
        }
      } else if (change.kind === "create") {
        if (change.targetBlueprintId || change.targetBlueprintVersion || change.targetWorkflowId) {
          throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} cannot include a lifecycle target.`);
        }
      }
    }
  }

  if (database) {
    const userId = localUserId(principal);
    if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");

    const canManage = await withOrganizationContext(database, principal.organizationId, async (db) => {
      const [permission] = await db
        .select({ membershipId: organizationMemberships.id })
        .from(organizationMemberships)
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, organizationMemberships.roleId))
        .where(
          and(
            eq(organizationMemberships.organizationId, principal.organizationId),
            eq(organizationMemberships.userId, userId),
            eq(organizationMemberships.status, "active"),
            eq(rolePermissions.permission, "workflows:manage"),
          ),
        )
        .limit(1);
      return Boolean(permission);
    });
    if (!canManage) throw workflowServiceError("FORBIDDEN", "The user cannot validate workflow change plans.");
  }

  return {
    planId: plan.planId,
    organizationId: plan.organizationId,
    changeCount: plan.changes.length,
    approvalRequired: plan.changes.some((change) => change.requiresApproval),
    status: "validated_not_applied",
    applyStatus: "deferred_persistence_and_approval",
  };
}
