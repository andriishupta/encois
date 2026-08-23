import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { ContractVersion, isJsonObject, parseWorkflowBlueprint, Permission, TemporalWorkflowType, WorkflowExecutionStatus } from "@encois/contracts";
import type {
  DataProvenance,
  ExecutionScope,
  JsonObject,
  SourceFreshness,
  WorkflowBlueprint,
  WorkflowChangePlan,
  WorkflowEvidenceProjection,
  WorkflowTraceProjection,
} from "@encois/contracts";
import {
  organizationMemberships,
  auditEvents,
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
import { hasPermission, hasPrincipalPermission } from "../../auth/authorization.js";
import { createExecutionCapability } from "../../security/execution-capability.js";
import type { WorkflowClient, WorkflowResultReader } from "../temporal-client.js";
import {
  buildWorkflowId,
  type WorkflowExecutionProjection,
  type WorkflowEventProjection,
  type WorkflowRecentActivityProjection,
  type WorkflowSignalRequest,
  type WorkflowStartRequest,
  type WorkflowUpdateRequest,
} from "../types.js";

export type WorkflowServiceOptions = {
  workflowClient: WorkflowClient;
  policyVersion: string;
  namespace: string;
  taskQueue: string;
  capabilitySecret?: string;
  capabilityTtlMs?: number;
  workflowRunRetentionDays?: number;
};

export type WorkflowServiceError = Error & {
  code: string;
};

export type WorkflowChangePlanInput = WorkflowChangePlan;

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

function workflowScopeIsVisible(scope: unknown, principalScope: readonly string[]): boolean {
  if (!isJsonObject(scope) || !Array.isArray(scope.ids)) return false;
  if (principalScope.includes("*")) return true;
  return scope.ids.some((id) => typeof id === "string" && principalScope.includes(id));
}

function blueprintFromPayload(payload: JsonObject): WorkflowBlueprint | undefined {
  if (isJsonObject(payload.blueprint)) return parseWorkflowBlueprint(payload.blueprint) ?? undefined;
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
  if (isJsonObject(payload.businessInput)) return payload.businessInput;
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
  capabilitySecret: string,
  capabilityTtlMs: number | undefined,
  lineage: WorkflowStartLineage = {},
) {
  const payload = request.input ?? {};
  const blueprint = getBlueprint(request, payload);
  const businessInput = getBusinessInput(request, payload);
  const requestedScope = request.scope;
  if (requestedScope && Object.keys(requestedScope).some((key) => key !== "ids")) {
    throw workflowServiceError("INVALID_SCOPE", "Execution scope may contain only organization-unit ids.");
  }
  const requestedIds = requestedScope?.ids;
  if (requestedIds !== undefined && requestedIds.length === 0) {
    throw workflowServiceError("INVALID_SCOPE", "Execution scope must contain at least one organization-unit id.");
  }
  const scope: ExecutionScope = { ids: [...new Set(requestedIds ?? principal.scope)].sort() };
  if (!principal.scope.includes("*") && scope.ids.some((id) => !principal.scope.includes(id))) {
    throw workflowServiceError("SCOPE_DENIED", "The requested workflow scope exceeds the caller's organization-unit scope.");
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
  trigger?: "manual" | "rerun" | "retry";
};

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isJsonObject(value)) {
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

function metadataString(metadata: JsonObject, key: string): string | undefined {
  return typeof metadata[key] === "string" && metadata[key] ? metadata[key] as string : undefined;
}

function metadataNumber(metadata: JsonObject, key: string): number | undefined {
  return typeof metadata[key] === "number" && Number.isFinite(metadata[key]) ? metadata[key] as number : undefined;
}

function dataProvenance(value: unknown): DataProvenance | undefined {
  if (!isJsonObject(value) || typeof value.source !== "string" || typeof value.observedAt !== "string") return undefined;
  return {
    source: value.source,
    observedAt: value.observedAt,
    ...(typeof value.sourceId === "string" ? { sourceId: value.sourceId } : {}),
    ...(typeof value.sourceRevisionId === "string" ? { sourceRevisionId: value.sourceRevisionId } : {}),
    ...(typeof value.sourceRecordId === "string" ? { sourceRecordId: value.sourceRecordId } : {}),
    ...(typeof value.artifactRef === "string" ? { artifactRef: value.artifactRef } : {}),
    ...(isJsonObject(value.locator) ? { locator: value.locator } : {}),
    ...(typeof value.ingestedAt === "string" ? { ingestedAt: value.ingestedAt } : {}),
    ...(typeof value.transformationVersion === "string" ? { transformationVersion: value.transformationVersion } : {}),
    ...(Array.isArray(value.visibilityScope) && value.visibilityScope.every((item) => typeof item === "string") ? { visibilityScope: value.visibilityScope as string[] } : {}),
  };
}

function runtimeTrace(value: unknown): WorkflowTraceProjection | undefined {
  if (!isJsonObject(value)) return undefined;
  for (const key of ["provider", "model", "budget", "outcome"] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key])) return undefined;
  }
  const durationMs = typeof value.durationMs === "number" && Number.isFinite(value.durationMs) ? value.durationMs : undefined;
  const attempt = typeof value.attempt === "number" && Number.isFinite(value.attempt) ? value.attempt : undefined;
  if (value.durationMs !== undefined && (durationMs === undefined || durationMs < 0)) return undefined;
  if (value.attempt !== undefined && (attempt === undefined || !Number.isInteger(attempt) || attempt < 1)) return undefined;
  if (value.redacted !== undefined && typeof value.redacted !== "boolean") return undefined;
  const trace: WorkflowTraceProjection = {
    ...(typeof value.provider === "string" && value.provider ? { provider: value.provider } : {}),
    ...(typeof value.model === "string" && value.model ? { model: value.model } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(typeof value.budget === "string" && value.budget ? { budget: value.budget } : {}),
    ...(typeof value.outcome === "string" && value.outcome ? { outcome: value.outcome } : {}),
    ...(typeof value.redacted === "boolean" ? { redacted: value.redacted } : {}),
  };
  return Object.keys(trace).length ? trace : undefined;
}

function sourceFreshness(value: unknown): SourceFreshness | undefined {
  if (!isJsonObject(value) || typeof value.source !== "string" || typeof value.observedAt !== "string" || !["fresh", "stale", "unknown"].includes(String(value.status))) return undefined;
  return {
    source: value.source,
    observedAt: value.observedAt,
    status: value.status as SourceFreshness["status"],
    ...(typeof value.ingestedAt === "string" ? { ingestedAt: value.ingestedAt } : {}),
    ...(typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {}),
  };
}

type RuntimeWorkflowStepResult = {
  stepId: string;
  status: string;
  evidenceRefs: readonly string[];
  provenance?: DataProvenance;
  confidence?: number;
  trace?: WorkflowTraceProjection;
  freshness: readonly SourceFreshness[];
};

type RuntimeWorkflowResult = {
  status: string;
  steps: readonly RuntimeWorkflowStepResult[];
};

export function parseRuntimeWorkflowResult(value: unknown): RuntimeWorkflowResult | undefined {
  if (!isJsonObject(value) || value.contractVersion !== ContractVersion.WorkflowResult || !Array.isArray(value.steps)) return undefined;
  const steps: RuntimeWorkflowStepResult[] = [];
  for (const rawStep of value.steps) {
    if (!isJsonObject(rawStep) || typeof rawStep.stepId !== "string" || typeof rawStep.status !== "string") return undefined;
    if (rawStep.confidence !== undefined && (typeof rawStep.confidence !== "number" || !Number.isFinite(rawStep.confidence) || rawStep.confidence < 0 || rawStep.confidence > 1)) return undefined;
    if (rawStep.trace !== undefined && !runtimeTrace(rawStep.trace)) return undefined;
    const evidenceRefs = Array.isArray(rawStep.evidenceRefs) && rawStep.evidenceRefs.every((ref) => typeof ref === "string" && ref.length > 0)
      ? rawStep.evidenceRefs as string[]
      : [];
    const freshness = Array.isArray(rawStep.freshness)
      ? rawStep.freshness.map(sourceFreshness).filter((entry): entry is SourceFreshness => Boolean(entry))
      : [];
    steps.push({
      stepId: rawStep.stepId,
      status: rawStep.status,
      evidenceRefs,
      ...(dataProvenance(rawStep.provenance) ? { provenance: dataProvenance(rawStep.provenance) } : {}),
      ...(typeof rawStep.confidence === "number" ? { confidence: rawStep.confidence } : {}),
      ...(runtimeTrace(rawStep.trace) ? { trace: runtimeTrace(rawStep.trace) } : {}),
      freshness,
    });
  }
  return typeof value.status === "string" ? { status: value.status, steps } : undefined;
}

async function projectRuntimeWorkflowResult(
  principal: AosPrincipal,
  workflowRunId: string,
  workflowId: string,
  options: WorkflowServiceOptions,
  occurredAt: Date,
): Promise<void> {
  if (!database) return;
  const reader = options.workflowClient as unknown as WorkflowResultReader;
  if (typeof reader.GetResult !== "function") return;
  const rawResult = await reader.GetResult(workflowId, principal.organizationId, options.namespace).catch(() => null);
  const result = parseRuntimeWorkflowResult(rawResult);
  if (!result) return;

  await withOrganizationContext(database, principal.organizationId, async (db) => {
    for (const step of result.steps) {
      const projectionKey = `workflow-result:${workflowRunId}:${step.stepId}`;
      const [claim] = await db
        .insert(idempotencyKeys)
        .values({
          organizationId: principal.organizationId,
          key: projectionKey,
          requestHash: createHash("sha256").update(stableSerialize({ status: result.status, step })).digest("hex"),
          resourceType: "workflow_event_projection",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        })
        .onConflictDoNothing()
        .returning({ id: idempotencyKeys.id });
      if (!claim) continue;

      const evidenceRefs = [...step.evidenceRefs];
      const metadata: JsonObject = {
        projection: "temporal_result",
        projectionKey,
        stepId: step.stepId,
        runtimeStatus: step.status,
        ...(evidenceRefs.length ? { evidenceRefs } : {}),
        ...(step.provenance ? { provenance: step.provenance as unknown as JsonObject } : {}),
        ...(step.confidence !== undefined ? { confidence: step.confidence } : {}),
        ...(step.trace?.provider ? { provider: step.trace.provider } : {}),
        ...(step.trace?.model ? { model: step.trace.model } : {}),
        ...(step.trace?.durationMs !== undefined ? { durationMs: step.trace.durationMs } : {}),
        ...(step.trace?.attempt !== undefined ? { attempt: step.trace.attempt } : {}),
        ...(step.trace?.budget ? { budget: step.trace.budget } : {}),
        ...(step.trace?.outcome ? { outcome: step.trace.outcome } : {}),
        ...(step.trace?.redacted !== undefined ? { redacted: step.trace.redacted } : {}),
        ...(step.freshness[0] ? { freshness: step.freshness[0] as unknown as JsonObject } : {}),
      };
      await db.insert(workflowEvents).values({
        organizationId: principal.organizationId,
        workflowRunId,
        eventType: step.status === "failed" ? "activity_failed" : step.status === "waiting" ? "activity_waiting" : "activity_completed",
        status: step.status,
        activityName: step.stepId,
        ...(evidenceRefs[0] ? { evidenceRef: evidenceRefs[0] } : {}),
        metadata,
        occurredAt,
      });
    }
  });
}

export function workflowEventProjection(row: typeof workflowEvents.$inferSelect): WorkflowEventProjection {
  const metadata = isJsonObject(row.metadata) ? row.metadata : {};
  const references = new Set<string>();
  if (row.evidenceRef) references.add(row.evidenceRef);
  if (Array.isArray(metadata.evidenceRefs)) {
    for (const reference of metadata.evidenceRefs) if (typeof reference === "string" && reference) references.add(reference);
  }
  const provenance = dataProvenance(metadata.provenance);
  const freshness = sourceFreshness(metadata.freshness);
  const confidence = metadataNumber(metadata, "confidence");
  const evidence: readonly WorkflowEvidenceProjection[] = [...references].map((reference) => ({
    reference,
    ...(provenance ? { provenance } : {}),
    ...(freshness ? { freshness } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  }));
  const trace: WorkflowTraceProjection = {
    ...(metadataString(metadata, "provider") ? { provider: metadataString(metadata, "provider") } : {}),
    ...(metadataString(metadata, "model") ? { model: metadataString(metadata, "model") } : {}),
    ...(metadataNumber(metadata, "durationMs") !== undefined ? { durationMs: metadataNumber(metadata, "durationMs") } : {}),
    ...(metadataNumber(metadata, "attempt") !== undefined ? { attempt: metadataNumber(metadata, "attempt") } : {}),
    ...(metadataString(metadata, "budget") ? { budget: metadataString(metadata, "budget") } : {}),
    ...(metadataString(metadata, "outcome") ? { outcome: metadataString(metadata, "outcome") } : {}),
    ...(typeof metadata.redacted === "boolean" ? { redacted: metadata.redacted } : {}),
  };
  const hasTrace = Object.keys(trace).length > 0;
  return {
    id: row.id,
    eventType: row.eventType,
    status: row.status,
    ...(row.activityName ? { activityName: row.activityName } : {}),
    ...(row.agentRunId ? { agentRunId: row.agentRunId } : {}),
    ...(row.evidenceRef ? { evidenceRef: row.evidenceRef } : {}),
    ...(evidence.length ? { evidence } : {}),
    ...(hasTrace ? { trace } : {}),
    metadata,
    occurredAt: row.occurredAt.toISOString(),
  };
}

async function syncWorkflowProjection(
  organizationId: string,
  projection: WorkflowExecutionProjection,
): Promise<WorkflowExecutionProjection> {
  if (!database) return projection;

  const preservePaused = await withOrganizationContext(database, organizationId, async (db) => {
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
    if (!run) return false;

    const updatedAt = parseDate(projection.updatedAt) ?? new Date();
    const startedAt = parseDate(projection.createdAt);
    const completedStatuses = new Set<WorkflowExecutionStatus>([WorkflowExecutionStatus.Completed, WorkflowExecutionStatus.Failed, WorkflowExecutionStatus.Cancelled]);
    const completedAt = completedStatuses.has(projection.status) ? updatedAt : undefined;
    const preservePaused = run.status === WorkflowExecutionStatus.Paused && !completedStatuses.has(projection.status);
    const effectiveStatus = preservePaused ? WorkflowExecutionStatus.Paused : projection.status;
    await db
      .update(workflowRuns)
      .set({
        status: effectiveStatus,
        temporalRunId: projection.runId,
        ...(startedAt ? { startedAt } : {}),
        ...(completedAt ? { completedAt } : {}),
        updatedAt,
      })
      .where(eq(workflowRuns.id, run.id));

    if (run.status !== effectiveStatus) {
      await db.insert(workflowEvents).values({
        organizationId,
        workflowRunId: run.id,
        eventType: "workflow_status_updated",
        status: effectiveStatus,
        metadata: {
          source: "temporal_visibility",
          previousStatus: run.status,
          runId: projection.runId,
        },
        occurredAt: updatedAt,
      });
    }
    return preservePaused;
  });
  return preservePaused ? { ...projection, status: WorkflowExecutionStatus.Paused, statusMessage: "Paused by an authorized operator." } : projection;
}

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
    workflowType: request.workflowType,
    key: request.key ?? request.idempotencyKey ?? requestId,
  });
  const fingerprint = requestHash(request);
  const capabilitySecret = options.capabilitySecret;

  if (!capabilitySecret) {
    throw workflowServiceError("CAPABILITY_NOT_CONFIGURED", "Execution capability signing is not configured.");
  }

  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRun)) {
      throw workflowServiceError("FORBIDDEN", "The user cannot start workflows.");
    }
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
          capabilitySecret,
          options.capabilityTtlMs,
          lineage,
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
    if (!(await hasPermission(db, principal, Permission.WorkflowsRun))) {
      throw workflowServiceError("FORBIDDEN", "The user cannot start workflows.");
    }

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
      .select({ workflowId: workflowRuns.temporalWorkflowId, scope: workflowRuns.scope })
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
      capabilitySecret,
      options.capabilityTtlMs,
      lineage,
    );
    const projection = await options.workflowClient.start(command, options.namespace);
    const retentionUntil = new Date(Date.now() + (options.workflowRunRetentionDays ?? 30) * 24 * 60 * 60 * 1000);

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
        blueprintId: command.input.blueprint?.blueprintId,
        blueprintVersion: command.input.blueprint?.version ?? command.input.blueprintVersion,
        parentWorkflowId: command.input.parentWorkflowId,
        trigger: command.input.trigger ?? "manual",
        status: projection.status,
        scope: command.input.scope,
        businessInput: command.input.businessInput ?? {},
        retentionUntil,
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

    return { ...projection, retentionUntil: retentionUntil.toISOString() };
  });
}

export async function getWorkflow(
  principal: AosPrincipal,
  workflowId: string,
  options: WorkflowServiceOptions,
): Promise<WorkflowExecutionProjection | null> {
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRead)) {
      throw workflowServiceError("FORBIDDEN", "The user cannot read workflows.");
    }
    return options.workflowClient.get(workflowId, principal.organizationId, options.namespace);
  }

  const userId = localUserId(principal);
  if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");

  const authorized = await withOrganizationContext(database, principal.organizationId, async (db) => {
    if (!(await hasPermission(db, principal, Permission.WorkflowsRead))) {
      throw workflowServiceError("FORBIDDEN", "The user cannot read workflows.");
    }
    const [row] = await db
      .select({ workflowId: workflowRuns.temporalWorkflowId, scope: workflowRuns.scope })
      .from(workflowRuns)
      .leftJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowRuns.definitionId))
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
          or(isNull(workflowDefinitions.key), ne(workflowDefinitions.key, TemporalWorkflowType.Coordinator)),
          or(
            eq(workflowRuns.actorUserId, userId),
            eq(rolePermissions.permission, Permission.WorkflowsRead),
            eq(rolePermissions.permission, Permission.WorkflowsManage),
          ),
        ),
      )
      .limit(1);
    return row && workflowScopeIsVisible(row.scope, principal.scope) ? row.workflowId : null;
  });

  if (!authorized) return null;
  const projection = await options.workflowClient.get(workflowId, principal.organizationId, options.namespace);
  if (projection) return syncWorkflowProjection(principal.organizationId, projection);
  return projection;
}

export async function getWorkflowEvents(
  principal: AosPrincipal,
  workflowId: string,
  options: WorkflowServiceOptions,
): Promise<readonly WorkflowEventProjection[] | null> {
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRead)) {
      throw workflowServiceError("FORBIDDEN", "The user cannot read workflows.");
    }
    const workflow = await options.workflowClient.get(workflowId, principal.organizationId, options.namespace);
    return workflow ? [] : null;
  }

  const userId = localUserId(principal);
  if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");

  const run = await withOrganizationContext(database, principal.organizationId, async (db) => {
    if (!(await hasPermission(db, principal, Permission.WorkflowsRead))) {
      throw workflowServiceError("FORBIDDEN", "The user cannot read workflows.");
    }
    const [row] = await db
      .select({ runId: workflowRuns.id, temporalWorkflowId: workflowRuns.temporalWorkflowId, scope: workflowRuns.scope })
      .from(workflowRuns)
      .leftJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowRuns.definitionId))
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
          or(isNull(workflowDefinitions.key), ne(workflowDefinitions.key, TemporalWorkflowType.Coordinator)),
          or(
            eq(workflowRuns.actorUserId, userId),
            eq(rolePermissions.permission, Permission.WorkflowsRead),
            eq(rolePermissions.permission, Permission.WorkflowsManage),
          ),
        ),
      )
      .limit(1);
    return row && workflowScopeIsVisible(row.scope, principal.scope) ? row : null;
  });

  if (!run) return null;

  const projection = await options.workflowClient.get(workflowId, principal.organizationId, options.namespace).catch(() => null);
  if (projection && new Set<WorkflowExecutionStatus>([
    WorkflowExecutionStatus.Completed,
    WorkflowExecutionStatus.Failed,
    WorkflowExecutionStatus.Partial,
    WorkflowExecutionStatus.Cancelled,
  ]).has(projection.status)) {
    await projectRuntimeWorkflowResult(
      principal,
      run.runId,
      run.temporalWorkflowId,
      options,
      parseDate(projection.updatedAt) ?? new Date(),
    );
  }

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const rows = await db
      .select()
      .from(workflowEvents)
      .where(and(eq(workflowEvents.organizationId, principal.organizationId), eq(workflowEvents.workflowRunId, run.runId)))
      .orderBy(workflowEvents.occurredAt);
    return rows.map(workflowEventProjection) satisfies readonly WorkflowEventProjection[];
  });
}

export async function listWorkflowActivity(
  principal: AosPrincipal,
  options: WorkflowServiceOptions,
  limit = 10,
): Promise<readonly WorkflowRecentActivityProjection[]> {
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRead)) {
      throw workflowServiceError("FORBIDDEN", "The user cannot read workflows.");
    }
    return [];
  }

  const workflows = await listWorkflows(principal, options);
  if (workflows.length === 0) return [];
  const workflowIds = workflows.map((workflow) => workflow.workflowId);
  const workflowById = new Map(workflows.map((workflow) => [workflow.workflowId, workflow]));

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const runs = await db
      .select({ id: workflowRuns.id, workflowId: workflowRuns.temporalWorkflowId })
      .from(workflowRuns)
      .where(and(eq(workflowRuns.organizationId, principal.organizationId), inArray(workflowRuns.temporalWorkflowId, workflowIds)));
    if (runs.length === 0) return [];
    const runIds = runs.map((run) => run.id);
    const workflowByRunId = new Map(runs.map((run) => [run.id, run.workflowId]));
    const rows = await db
      .select()
      .from(workflowEvents)
      .where(and(eq(workflowEvents.organizationId, principal.organizationId), inArray(workflowEvents.workflowRunId, runIds)))
      .orderBy(desc(workflowEvents.occurredAt))
      .limit(Math.max(1, Math.min(limit, 50)));
    return rows.map((row) => {
      const workflowId = workflowByRunId.get(row.workflowRunId) ?? "";
      const workflow = workflowById.get(workflowId);
      return {
        ...workflowEventProjection(row),
        workflowId,
        workflowLabel: workflow?.blueprintId ?? workflow?.workflowType ?? "Workflow",
      } satisfies WorkflowRecentActivityProjection;
    });
  });
}

export async function listWorkflows(
  principal: AosPrincipal,
  options: WorkflowServiceOptions,
): Promise<readonly WorkflowExecutionProjection[]> {
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRead)) {
      throw workflowServiceError("FORBIDDEN", "The user cannot read workflows.");
    }
    return options.workflowClient.list(principal.organizationId, options.namespace);
  }

  const userId = localUserId(principal);
  if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");

  const visible = await withOrganizationContext(database, principal.organizationId, async (db) => {
    if (!(await hasPermission(db, principal, Permission.WorkflowsRead))) {
      throw workflowServiceError("FORBIDDEN", "The user cannot read workflows.");
    }
    const rows = await db
      .select({ workflowId: workflowRuns.temporalWorkflowId, scope: workflowRuns.scope })
      .from(workflowRuns)
      .leftJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowRuns.definitionId))
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
          or(isNull(workflowDefinitions.key), ne(workflowDefinitions.key, TemporalWorkflowType.Coordinator)),
          or(
            eq(workflowRuns.actorUserId, userId),
            eq(rolePermissions.permission, Permission.WorkflowsRead),
            eq(rolePermissions.permission, Permission.WorkflowsManage),
          ),
        ),
      );
    return new Set(rows.filter((row) => workflowScopeIsVisible(row.scope, principal.scope)).map((row) => row.workflowId));
  });

  const projections = await options.workflowClient.list(principal.organizationId, options.namespace);
  const visibleProjections = projections.filter((projection) => visible.has(projection.workflowId));
  return Promise.all(visibleProjections.map((projection) => syncWorkflowProjection(principal.organizationId, projection)));
}

export async function signalWorkflow(
  principal: AosPrincipal,
  workflowId: string,
  request: WorkflowSignalRequest,
  options: WorkflowServiceOptions,
): Promise<void> {
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRun)) {
      throw workflowServiceError("FORBIDDEN", "The user cannot change this workflow state.");
    }
  } else {
    const canRun = await withOrganizationContext(database, principal.organizationId, (db) => hasPermission(db, principal, Permission.WorkflowsRun));
    if (!canRun) throw workflowServiceError("FORBIDDEN", "The user cannot change this workflow state.");
  }

  const visible = await getWorkflow(principal, workflowId, options);
  if (!visible) throw workflowServiceError("WORKFLOW_NOT_FOUND", "Workflow not found.");
  if (visible.status !== "queued" && visible.status !== "running" && visible.status !== "waiting" && visible.status !== "paused") {
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
      if (!(await hasPermission(db, principal, Permission.WorkflowsRun))) return null;
      const [row] = await db
        .select({ workflowId: workflowRuns.temporalWorkflowId, workflowRunId: workflowRuns.id, scope: workflowRuns.scope })
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
              eq(rolePermissions.permission, Permission.WorkflowsRun),
              eq(rolePermissions.permission, Permission.WorkflowsManage),
            ),
          ),
        )
        .limit(1);
      return row && workflowScopeIsVisible(row.scope, principal.scope) ? row.workflowRunId : null;
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
    const runtimeRequest: WorkflowSignalRequest = request.signalName === "blueprint-approval"
      ? { ...request, payload: { ...request.payload, signalId: request.signalId } }
      : { ...request, payload: { ...request.payload, signalId: request.signalId } };
    await options.workflowClient.signal(workflowId, principal.organizationId, options.namespace, runtimeRequest);
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
      const controlStatus = request.signalName === "workflow-pause"
        ? WorkflowExecutionStatus.Paused
        : request.signalName === "workflow-resume"
          ? WorkflowExecutionStatus.Running
          : undefined;
      if (controlStatus) {
        await db.update(workflowRuns).set({ status: controlStatus, updatedAt: new Date() }).where(and(eq(workflowRuns.organizationId, principal.organizationId), eq(workflowRuns.id, workflowRunId)));
      }
      await markWorkflowCommandAccepted(db, principal.organizationId, workflowId, "signal", request.signalId);
      await db.insert(workflowEvents).values({
        organizationId: principal.organizationId,
        workflowRunId,
        eventType: "workflow_signal_sent",
        status: visible.status,
        metadata: {
          signalId: request.signalId,
          signalName: request.signalName,
          ...(request.signalName === "blueprint-approval" ? { stepId: request.payload.stepId, approved: request.payload.approved } : {}),
          ...(request.signalName !== "blueprint-approval" && request.payload.reason ? { reason: request.payload.reason } : {}),
          actorId: principal.actorId,
        },
      });
    });
  }
}

export async function rerunWorkflow(
  principal: AosPrincipal,
  workflowId: string,
  requestId: string,
  traceId: string,
  options: WorkflowServiceOptions,
  mode: "rerun" | "retry" = "rerun",
): Promise<WorkflowExecutionProjection> {
  if (!database) throw workflowServiceError("PERSISTENCE_UNAVAILABLE", "Run again requires persisted workflow history.");
  const userId = localUserId(principal);
  if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");
  const canRun = await withOrganizationContext(database, principal.organizationId, (db) => hasPermission(db, principal, Permission.WorkflowsRun));
  if (!canRun) throw workflowServiceError("FORBIDDEN", `The user cannot ${mode} workflows.`);

  const previous = await getWorkflow(principal, workflowId, options);
  if (!previous) throw workflowServiceError("WORKFLOW_NOT_FOUND", "Workflow not found.");
  const rerunnableStatuses: readonly WorkflowExecutionStatus[] = mode === "retry"
    ? [WorkflowExecutionStatus.Partial, WorkflowExecutionStatus.Failed]
    : [WorkflowExecutionStatus.Completed, WorkflowExecutionStatus.Cancelled];
  if (!rerunnableStatuses.includes(previous.status)) {
    throw workflowServiceError("WORKFLOW_NOT_RERUNNABLE", `Workflow is ${previous.status} and cannot be ${mode === "retry" ? "retried" : "run again"}.`);
  }

  const source = await withOrganizationContext(database, principal.organizationId, async (db) => {
    const [row] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.organizationId, principal.organizationId), eq(workflowRuns.temporalWorkflowId, workflowId)))
      .limit(1);
    if (!row || !workflowScopeIsVisible(row.scope, principal.scope)) return null;
    const blueprintId = row.blueprintId ?? row.inputRef;
    if (!blueprintId || !row.blueprintVersion) throw workflowServiceError("WORKFLOW_REVISION_UNAVAILABLE", "The original Blueprint revision is not stored for this run.");
    const scope = isJsonObject(row.scope) && Array.isArray(row.scope.ids) && row.scope.ids.every((id) => typeof id === "string") ? { ids: row.scope.ids as string[] } : null;
    if (!scope) throw workflowServiceError("WORKFLOW_SCOPE_UNAVAILABLE", "The original execution scope is not available for this run.");
    const [blueprintRow] = await db
      .select({ blueprint: workflowBlueprints.blueprint, status: workflowBlueprints.status })
      .from(workflowBlueprints)
      .where(and(eq(workflowBlueprints.organizationId, principal.organizationId), eq(workflowBlueprints.blueprintId, blueprintId), eq(workflowBlueprints.version, row.blueprintVersion)))
      .limit(1);
    if (!blueprintRow || blueprintRow.status !== "approved") throw workflowServiceError("WORKFLOW_REVISION_UNAVAILABLE", "The original approved Blueprint revision is no longer available.");
    const businessInput = isJsonObject(row.businessInput) ? row.businessInput : {};
    return { blueprintId, blueprintVersion: row.blueprintVersion, scope, businessInput };
  });
  if (!source) throw workflowServiceError("FORBIDDEN", `The user cannot ${mode} this workflow in the current scope.`);

  const projection = await startWorkflow(
    principal,
    {
      workflowType: TemporalWorkflowType.UserBlueprint,
      version: "v1",
      key: `${mode}-${randomUUID()}`,
      blueprintId: source.blueprintId,
      blueprintVersion: source.blueprintVersion,
      scope: source.scope,
      input: { businessInput: source.businessInput },
    },
    requestId,
    traceId,
    options,
    { parentWorkflowId: workflowId, trigger: mode },
  );

  await withOrganizationContext(database, principal.organizationId, async (db) => {
    await db.insert(auditEvents).values({
      organizationId: principal.organizationId,
      actorUserId: userId,
      action: `workflow.${mode}.started`,
      outcome: "accepted",
      resourceType: "workflow_run",
      resourceId: projection.workflowId,
      scope: source.scope,
      metadata: { parentWorkflowId: workflowId, blueprintId: source.blueprintId, blueprintVersion: source.blueprintVersion },
    });
  });
  return projection;
}

export async function cancelWorkflow(
  principal: AosPrincipal,
  workflowId: string,
  options: WorkflowServiceOptions,
): Promise<void> {
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsRun)) throw workflowServiceError("FORBIDDEN", "The user cannot cancel this workflow.");
  } else {
    const canRun = await withOrganizationContext(database, principal.organizationId, (db) => hasPermission(db, principal, Permission.WorkflowsRun));
    if (!canRun) throw workflowServiceError("FORBIDDEN", "The user cannot cancel this workflow.");
  }

  const visible = await getWorkflow(principal, workflowId, options);
  if (!visible) throw workflowServiceError("WORKFLOW_NOT_FOUND", "Workflow not found.");
  if (!["queued", "running", "waiting", "paused"].includes(visible.status)) {
    throw workflowServiceError("WORKFLOW_NOT_CANCELLABLE", `Workflow is ${visible.status} and cannot be cancelled.`);
  }

  let workflowRunId: string | undefined;
  if (database) {
    const userId = localUserId(principal);
    if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");
    workflowRunId = await withOrganizationContext(database, principal.organizationId, async (db) => {
      const [row] = await db
        .select({ workflowRunId: workflowRuns.id, scope: workflowRuns.scope })
        .from(workflowRuns)
        .innerJoin(organizationMemberships, and(
          eq(organizationMemberships.organizationId, principal.organizationId),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, "active"),
        ))
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, organizationMemberships.roleId))
        .where(and(
          eq(workflowRuns.organizationId, principal.organizationId),
          eq(workflowRuns.temporalWorkflowId, workflowId),
          or(eq(workflowRuns.actorUserId, userId), eq(rolePermissions.permission, Permission.WorkflowsRun), eq(rolePermissions.permission, Permission.WorkflowsManage)),
        ))
        .limit(1);
      return row && workflowScopeIsVisible(row.scope, principal.scope) ? row.workflowRunId : undefined;
    });
    if (!workflowRunId) throw workflowServiceError("FORBIDDEN", "The user cannot cancel this workflow.");
  }

  try {
    await options.workflowClient.cancel(workflowId, principal.organizationId, options.namespace);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow cancellation failed.";
    if (message.includes("not found")) throw workflowServiceError("WORKFLOW_NOT_FOUND", "Workflow not found.");
    if (message.includes("cannot be cancelled")) throw workflowServiceError("WORKFLOW_NOT_CANCELLABLE", message);
    throw workflowServiceError("WORKFLOW_CANCEL_FAILED", message);
  }

  if (database && workflowRunId) {
    await withOrganizationContext(database, principal.organizationId, (db) => db.insert(workflowEvents).values({
      organizationId: principal.organizationId,
      workflowRunId,
      eventType: "workflow_cancel_requested",
      status: visible.status,
      metadata: { actorId: principal.actorId, reason: "user_requested" },
    }));
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
      throw workflowServiceError("FORBIDDEN", "The user cannot update this workflow.");
    }
  } else {
    const canRun = await withOrganizationContext(database, principal.organizationId, (db) => hasPermission(db, principal, Permission.WorkflowsRun));
    if (!canRun) throw workflowServiceError("FORBIDDEN", "The user cannot update this workflow.");
  }

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
      if (!(await hasPermission(db, principal, Permission.WorkflowsRun))) return undefined;
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
              eq(rolePermissions.permission, Permission.WorkflowsRun),
              eq(rolePermissions.permission, Permission.WorkflowsManage),
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
  if (!database) {
    if (!hasPrincipalPermission(principal, Permission.WorkflowsManage)) {
      throw workflowServiceError("FORBIDDEN", "The user cannot validate workflow change plans.");
    }
  } else {
    const canManage = await withOrganizationContext(database, principal.organizationId, (db) => hasPermission(db, principal, Permission.WorkflowsManage));
    if (!canManage) throw workflowServiceError("FORBIDDEN", "The user cannot validate workflow change plans.");
  }

  if (plan.organizationId !== principal.organizationId) {
    throw workflowServiceError("FORBIDDEN", "The workflow plan belongs to a different organization.");
  }

  if (plan.scope) {
    if (plan.scope.ids.length === 0 || plan.scope.ids.some((scope) => !scope.trim())) {
      throw workflowServiceError("WORKFLOW_PLAN_INVALID", "The workflow plan scope must contain at least one organization-unit id.");
    }
    if (!principal.scope.includes("*") && plan.scope.ids.some((scope) => !principal.scope.includes(scope))) {
      throw workflowServiceError("SCOPE_DENIED", "The workflow plan scope exceeds the caller's organization-unit scope.");
    }
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
    } else if (change.kind === "deprecate" || change.kind === "restore" || change.kind === "set_current") {
      if (!change.targetBlueprintId || !change.targetBlueprintVersion) {
        throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} requires a Blueprint target.`);
      }
      if (change.targetWorkflowId) {
        throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} cannot target a Temporal execution.`);
      }
      if (change.blueprint || change.start) {
        throw workflowServiceError("WORKFLOW_PLAN_INVALID", `Change ${index} cannot carry a Blueprint or start intent.`);
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

  return {
    planId: plan.planId,
    organizationId: plan.organizationId,
    changeCount: plan.changes.length,
    approvalRequired: plan.changes.some((change) => change.requiresApproval),
    status: "validated_not_applied",
    applyStatus: "deferred_persistence_and_approval",
  };
}
