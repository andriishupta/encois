import { createHash } from "node:crypto";
import type {
  DataProvenance,
  JsonObject,
  SourceFreshness,
  WorkflowEvidenceProjection,
  WorkflowTraceProjection,
} from "@encois/contracts";
import {
  ContractVersion,
  CoordinatorEventType,
  isJsonObject,
  WorkflowExecutionStatus,
  WorkflowStatusReason,
} from "@encois/contracts";
import {
  type DatabaseTransaction,
  idempotencyKeys,
  withOrganizationContext,
  workflowEvents,
  workflowRuns,
} from "@encois/database";
import { and, eq, sql } from "drizzle-orm";
import { database } from "../../database.js";
import type { AosPrincipal } from "../../middleware/aos.js";
import type {
  WorkflowClient,
  WorkflowResultReader,
} from "../temporal-client.js";
import type {
  WorkflowEventProjection,
  WorkflowExecutionProjection,
} from "../types.js";
import {
  coordinatorEventId,
  enqueueCoordinatorEvent,
} from "./coordinator-event.service.js";
import {
  persistedWorkflowRunStatus,
  stableSerialize,
} from "./workflow-service-common.js";

type RuntimeProjectionOptions = {
  workflowClient: WorkflowClient;
  namespace: string;
};

async function enqueueWorkflowCompletedEvent(
  db: DatabaseTransaction,
  organizationId: string,
  workflowRunId: string,
  workflowId: string,
  scope: Record<string, unknown>,
  occurredAt: Date,
  evidenceRefs: readonly string[] = [],
): Promise<void> {
  const ids = Array.isArray(scope.ids)
    ? scope.ids.filter(
        (id): id is string => typeof id === "string" && id !== "",
      )
    : [];
  await enqueueCoordinatorEvent(db, {
    organizationId,
    eventId: coordinatorEventId("workflow-completed", workflowRunId),
    eventType: CoordinatorEventType.WorkflowCompleted,
    workflowId,
    ...(ids.length > 0 ? { scope: { ids } } : {}),
    businessInput: { completedAt: occurredAt.toISOString() },
    reason: "Workflow execution completed in Temporal.",
    ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
  });
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function metadataString(metadata: JsonObject, key: string): string | undefined {
  return typeof metadata[key] === "string" && metadata[key]
    ? (metadata[key] as string)
    : undefined;
}

function metadataNumber(metadata: JsonObject, key: string): number | undefined {
  return typeof metadata[key] === "number" && Number.isFinite(metadata[key])
    ? (metadata[key] as number)
    : undefined;
}

function dataProvenance(value: unknown): DataProvenance | undefined {
  if (
    !isJsonObject(value) ||
    typeof value.source !== "string" ||
    typeof value.observedAt !== "string"
  )
    return undefined;
  return {
    source: value.source,
    observedAt: value.observedAt,
    ...(typeof value.sourceId === "string" ? { sourceId: value.sourceId } : {}),
    ...(typeof value.sourceRevisionId === "string"
      ? { sourceRevisionId: value.sourceRevisionId }
      : {}),
    ...(typeof value.sourceRecordId === "string"
      ? { sourceRecordId: value.sourceRecordId }
      : {}),
    ...(typeof value.artifactRef === "string"
      ? { artifactRef: value.artifactRef }
      : {}),
    ...(isJsonObject(value.locator) ? { locator: value.locator } : {}),
    ...(typeof value.ingestedAt === "string"
      ? { ingestedAt: value.ingestedAt }
      : {}),
    ...(typeof value.transformationVersion === "string"
      ? { transformationVersion: value.transformationVersion }
      : {}),
    ...(Array.isArray(value.visibilityScope) &&
    value.visibilityScope.every((item) => typeof item === "string")
      ? { visibilityScope: value.visibilityScope as string[] }
      : {}),
  };
}

function runtimeTrace(value: unknown): WorkflowTraceProjection | undefined {
  if (!isJsonObject(value)) return undefined;
  for (const key of ["provider", "model", "budget", "outcome"] as const) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== "string" || !value[key])
    )
      return undefined;
  }
  const durationMs =
    typeof value.durationMs === "number" && Number.isFinite(value.durationMs)
      ? value.durationMs
      : undefined;
  const attempt =
    typeof value.attempt === "number" && Number.isFinite(value.attempt)
      ? value.attempt
      : undefined;
  if (
    value.durationMs !== undefined &&
    (durationMs === undefined || durationMs < 0)
  )
    return undefined;
  if (
    value.attempt !== undefined &&
    (attempt === undefined || !Number.isInteger(attempt) || attempt < 1)
  )
    return undefined;
  if (value.redacted !== undefined && typeof value.redacted !== "boolean")
    return undefined;
  const trace: WorkflowTraceProjection = {
    ...(typeof value.provider === "string" && value.provider
      ? { provider: value.provider }
      : {}),
    ...(typeof value.model === "string" && value.model
      ? { model: value.model }
      : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(typeof value.budget === "string" && value.budget
      ? { budget: value.budget }
      : {}),
    ...(typeof value.outcome === "string" && value.outcome
      ? { outcome: value.outcome }
      : {}),
    ...(typeof value.redacted === "boolean"
      ? { redacted: value.redacted }
      : {}),
  };
  return Object.keys(trace).length ? trace : undefined;
}

function sourceFreshness(value: unknown): SourceFreshness | undefined {
  if (
    !isJsonObject(value) ||
    typeof value.source !== "string" ||
    typeof value.observedAt !== "string" ||
    !["fresh", "stale", "unknown"].includes(String(value.status))
  )
    return undefined;
  return {
    source: value.source,
    observedAt: value.observedAt,
    status: value.status as SourceFreshness["status"],
    ...(typeof value.ingestedAt === "string"
      ? { ingestedAt: value.ingestedAt }
      : {}),
    ...(typeof value.expiresAt === "string"
      ? { expiresAt: value.expiresAt }
      : {}),
  };
}

type RuntimeWorkflowStepResult = {
  stepId: string;
  status: string;
  statusReason?: WorkflowStatusReason;
  data?: JsonObject;
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

export function parseRuntimeWorkflowResult(
  value: unknown,
): RuntimeWorkflowResult | undefined {
  if (
    !isJsonObject(value) ||
    value.contractVersion !== ContractVersion.WorkflowResult ||
    !Array.isArray(value.steps)
  )
    return undefined;
  const steps: RuntimeWorkflowStepResult[] = [];
  for (const rawStep of value.steps) {
    if (
      !isJsonObject(rawStep) ||
      typeof rawStep.stepId !== "string" ||
      typeof rawStep.status !== "string"
    )
      return undefined;
    if (rawStep.data !== undefined && !isJsonObject(rawStep.data))
      return undefined;
    if (
      rawStep.statusReason !== undefined &&
      !Object.values(WorkflowStatusReason).includes(
        rawStep.statusReason as WorkflowStatusReason,
      )
    )
      return undefined;
    if (
      rawStep.confidence !== undefined &&
      (typeof rawStep.confidence !== "number" ||
        !Number.isFinite(rawStep.confidence) ||
        rawStep.confidence < 0 ||
        rawStep.confidence > 1)
    )
      return undefined;
    if (rawStep.trace !== undefined && !runtimeTrace(rawStep.trace))
      return undefined;
    const evidenceRefs =
      Array.isArray(rawStep.evidenceRefs) &&
      rawStep.evidenceRefs.every(
        (ref) => typeof ref === "string" && ref.length > 0,
      )
        ? (rawStep.evidenceRefs as string[])
        : [];
    const freshness = Array.isArray(rawStep.freshness)
      ? rawStep.freshness
          .map(sourceFreshness)
          .filter((entry): entry is SourceFreshness => Boolean(entry))
      : [];
    steps.push({
      stepId: rawStep.stepId,
      status: rawStep.status,
      ...(rawStep.statusReason
        ? { statusReason: rawStep.statusReason as WorkflowStatusReason }
        : {}),
      ...(isJsonObject(rawStep.data) ? { data: rawStep.data } : {}),
      evidenceRefs,
      ...(dataProvenance(rawStep.provenance)
        ? { provenance: dataProvenance(rawStep.provenance) }
        : {}),
      ...(typeof rawStep.confidence === "number"
        ? { confidence: rawStep.confidence }
        : {}),
      ...(runtimeTrace(rawStep.trace)
        ? { trace: runtimeTrace(rawStep.trace) }
        : {}),
      freshness,
    });
  }
  return typeof value.status === "string"
    ? { status: value.status, steps }
    : undefined;
}

export async function projectRuntimeWorkflowResult(
  principal: AosPrincipal,
  workflowRunId: string,
  workflowId: string,
  options: RuntimeProjectionOptions,
  occurredAt: Date,
): Promise<void> {
  if (!database) return;
  const reader = options.workflowClient as unknown as WorkflowResultReader;
  if (typeof reader.GetResult !== "function") return;
  const rawResult = await reader
    .GetResult(workflowId, principal.organizationId, options.namespace)
    .catch(() => null);
  const result = parseRuntimeWorkflowResult(rawResult);
  if (!result) return;

  await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      const runtimeStatus = workflowStatusFromRuntimeResult(result.status);
      if (runtimeStatus) {
        await db
          .update(workflowRuns)
          .set({
            status: persistedWorkflowRunStatus(runtimeStatus),
            ...(runtimeStatus === WorkflowExecutionStatus.Completed ||
            runtimeStatus === WorkflowExecutionStatus.Failed ||
            runtimeStatus === WorkflowExecutionStatus.Partial
              ? { completedAt: occurredAt }
              : {}),
            updatedAt: occurredAt,
          })
          .where(
            and(
              eq(workflowRuns.id, workflowRunId),
              eq(workflowRuns.organizationId, principal.organizationId),
            ),
          );
        if (runtimeStatus === WorkflowExecutionStatus.Completed) {
          const [run] = await db
            .select({ scope: workflowRuns.scope })
            .from(workflowRuns)
            .where(
              and(
                eq(workflowRuns.id, workflowRunId),
                eq(workflowRuns.organizationId, principal.organizationId),
              ),
            )
            .limit(1);
          if (run)
            await enqueueWorkflowCompletedEvent(
              db,
              principal.organizationId,
              workflowRunId,
              workflowId,
              run.scope,
              occurredAt,
              result.steps.flatMap((step) => step.evidenceRefs),
            );
        }
      }
      for (const step of result.steps) {
        const projectionKey = `workflow-result:${workflowRunId}:${step.stepId}`;
        const evidenceRefs = [...step.evidenceRefs];
        const metadata: JsonObject = {
          projection: "temporal_result",
          projectionKey,
          stepId: step.stepId,
          runtimeStatus: step.status,
          ...(step.statusReason ? { statusReason: step.statusReason } : {}),
          ...(step.data ? { data: step.data } : {}),
          ...(evidenceRefs.length ? { evidenceRefs } : {}),
          ...(step.provenance
            ? { provenance: step.provenance as unknown as JsonObject }
            : {}),
          ...(step.confidence !== undefined
            ? { confidence: step.confidence }
            : {}),
          ...(step.trace?.provider ? { provider: step.trace.provider } : {}),
          ...(step.trace?.model ? { model: step.trace.model } : {}),
          ...(step.trace?.durationMs !== undefined
            ? { durationMs: step.trace.durationMs }
            : {}),
          ...(step.trace?.attempt !== undefined
            ? { attempt: step.trace.attempt }
            : {}),
          ...(step.trace?.budget ? { budget: step.trace.budget } : {}),
          ...(step.trace?.outcome ? { outcome: step.trace.outcome } : {}),
          ...(step.trace?.redacted !== undefined
            ? { redacted: step.trace.redacted }
            : {}),
          ...(step.freshness[0]
            ? { freshness: step.freshness[0] as unknown as JsonObject }
            : {}),
        };
        const eventType =
          step.status === "failed"
            ? "activity_failed"
            : step.status === "waiting"
              ? "activity_waiting"
              : "activity_completed";
        const [claim] = await db
          .insert(idempotencyKeys)
          .values({
            organizationId: principal.organizationId,
            key: projectionKey,
            requestHash: createHash("sha256")
              .update(stableSerialize({ status: result.status, step }))
              .digest("hex"),
            resourceType: "workflow_event_projection",
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          })
          .onConflictDoNothing()
          .returning({ id: idempotencyKeys.id });
        if (!claim) {
          await db
            .update(workflowEvents)
            .set({
              eventType,
              status: step.status,
              activityName: step.stepId,
              ...(evidenceRefs[0] ? { evidenceRef: evidenceRefs[0] } : {}),
              metadata,
              occurredAt,
            })
            .where(
              and(
                eq(workflowEvents.organizationId, principal.organizationId),
                eq(workflowEvents.workflowRunId, workflowRunId),
                sql`${workflowEvents.metadata}->>'projectionKey' = ${projectionKey}`,
              ),
            );
          continue;
        }
        await db.insert(workflowEvents).values({
          organizationId: principal.organizationId,
          workflowRunId,
          eventType,
          status: step.status,
          activityName: step.stepId,
          ...(evidenceRefs[0] ? { evidenceRef: evidenceRefs[0] } : {}),
          metadata,
          occurredAt,
        });
      }
    },
  );
}

function workflowStatusFromRuntimeResult(
  status: string,
): WorkflowExecutionStatus | undefined {
  switch (status) {
    case "completed":
      return WorkflowExecutionStatus.Completed;
    case "partial":
      return WorkflowExecutionStatus.Partial;
    case "failed":
      return WorkflowExecutionStatus.Failed;
    case "waiting":
      return WorkflowExecutionStatus.Waiting;
    default:
      return undefined;
  }
}

export function workflowEventProjection(
  row: typeof workflowEvents.$inferSelect,
): WorkflowEventProjection {
  const metadata = isJsonObject(row.metadata) ? row.metadata : {};
  const references = new Set<string>();
  if (row.evidenceRef) references.add(row.evidenceRef);
  if (Array.isArray(metadata.evidenceRefs)) {
    for (const reference of metadata.evidenceRefs)
      if (typeof reference === "string" && reference) references.add(reference);
  }
  const provenance = dataProvenance(metadata.provenance);
  const freshness = sourceFreshness(metadata.freshness);
  const confidence = metadataNumber(metadata, "confidence");
  const statusReason = Object.values(WorkflowStatusReason).includes(
    metadata.statusReason as WorkflowStatusReason,
  )
    ? (metadata.statusReason as WorkflowStatusReason)
    : undefined;
  const evidence: readonly WorkflowEvidenceProjection[] = [...references].map(
    (reference) => ({
      reference,
      ...(provenance ? { provenance } : {}),
      ...(freshness ? { freshness } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    }),
  );
  const trace: WorkflowTraceProjection = {
    ...(metadataString(metadata, "provider")
      ? { provider: metadataString(metadata, "provider") }
      : {}),
    ...(metadataString(metadata, "model")
      ? { model: metadataString(metadata, "model") }
      : {}),
    ...(metadataNumber(metadata, "durationMs") !== undefined
      ? { durationMs: metadataNumber(metadata, "durationMs") }
      : {}),
    ...(metadataNumber(metadata, "attempt") !== undefined
      ? { attempt: metadataNumber(metadata, "attempt") }
      : {}),
    ...(metadataString(metadata, "budget")
      ? { budget: metadataString(metadata, "budget") }
      : {}),
    ...(metadataString(metadata, "outcome")
      ? { outcome: metadataString(metadata, "outcome") }
      : {}),
    ...(typeof metadata.redacted === "boolean"
      ? { redacted: metadata.redacted }
      : {}),
  };
  const hasTrace = Object.keys(trace).length > 0;
  return {
    id: row.id,
    eventType: row.eventType,
    status: row.status,
    ...(statusReason ? { statusReason } : {}),
    ...(row.activityName ? { activityName: row.activityName } : {}),
    ...(row.agentRunId ? { agentRunId: row.agentRunId } : {}),
    ...(row.evidenceRef ? { evidenceRef: row.evidenceRef } : {}),
    ...(evidence.length ? { evidence } : {}),
    ...(hasTrace ? { trace } : {}),
    metadata,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export async function syncWorkflowProjection(
  organizationId: string,
  projection: WorkflowExecutionProjection,
): Promise<WorkflowExecutionProjection> {
  if (!database) return projection;

  const preservePaused = await withOrganizationContext(
    database,
    organizationId,
    async (db) => {
      const [run] = await db
        .select({
          id: workflowRuns.id,
          status: workflowRuns.status,
          scope: workflowRuns.scope,
        })
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
      const completedStatuses = new Set<WorkflowExecutionStatus>([
        WorkflowExecutionStatus.Completed,
        WorkflowExecutionStatus.Failed,
        WorkflowExecutionStatus.Cancelled,
      ]);
      const completedAt = completedStatuses.has(projection.status)
        ? updatedAt
        : undefined;
      const preservePaused =
        run.status === WorkflowExecutionStatus.Paused &&
        !completedStatuses.has(projection.status);
      const preserveRuntimeResult =
        projection.status === WorkflowExecutionStatus.Completed &&
        (run.status === WorkflowExecutionStatus.Failed ||
          run.status === WorkflowExecutionStatus.Partial);
      const effectiveStatus = preservePaused
        ? WorkflowExecutionStatus.Paused
        : preserveRuntimeResult
          ? run.status
          : projection.status;
      await db
        .update(workflowRuns)
        .set({
          status: persistedWorkflowRunStatus(effectiveStatus),
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
        if (effectiveStatus === WorkflowExecutionStatus.Completed)
          await enqueueWorkflowCompletedEvent(
            db,
            organizationId,
            run.id,
            projection.workflowId,
            run.scope,
            updatedAt,
          );
      }
      return preservePaused;
    },
  );
  return preservePaused
    ? {
        ...projection,
        status: WorkflowExecutionStatus.Paused,
        statusMessage: "Paused by an authorized operator.",
      }
    : projection;
}
