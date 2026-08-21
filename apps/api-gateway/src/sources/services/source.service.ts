import { and, eq, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  ContractVersion,
  KnowledgeSourceKind,
  KnowledgeSourceStatus,
  SourceIngestionTrigger,
  SourceRevisionStatus,
  type ExecutionScope,
  type JsonObject,
  type KnowledgeSource,
  type KnowledgeSourceCreateRequest,
  type SourceIngestionRequest,
  type SourceRevision,
  type SourceRevisionCreateRequest,
} from "@encois/contracts";
import {
  integrations,
  knowledgeSources,
  organizationMemberships,
  rolePermissions,
  sourceIngestionRuns,
  sourceRevisions,
  withOrganizationContext,
  type PersistenceTransaction,
  type SourceScope,
} from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { database } from "../../database.js";
import type { WorkflowClient } from "../../workflows/temporal-client.js";
import { buildWorkflowId } from "../../workflows/types.js";

type QueryDatabase = NonNullable<typeof database> | PersistenceTransaction;

export type SourceServiceError = Error & { code: string };

export type SourceSummary = {
  source: KnowledgeSource;
  revisions: readonly SourceRevision[];
};

export type SourceIngestionLaunch = {
  source: KnowledgeSource;
  revision: SourceRevision;
  workflow: {
    workflowId: string;
    runId?: string;
    status: string;
    reused?: boolean;
  };
  resultContract: typeof ContractVersion.SourceIngestionResult;
};

export type SourceServiceOptions = {
  workflowClient: WorkflowClient;
  namespace: string;
  taskQueue: string;
  policyVersion: string;
};

export function sourceServiceError(code: string, message: string): SourceServiceError {
  const error = new Error(message) as SourceServiceError;
  error.code = code;
  return error;
}

export function isSourceServiceError(error: unknown): error is SourceServiceError {
  return error instanceof Error && typeof (error as Partial<SourceServiceError>).code === "string";
}

function localUserId(principal: AosPrincipal): string | null {
  const candidate = principal.userId ?? principal.actorId;
  return /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toScope(value: unknown): SourceScope | null {
  if (!isRecord(value) || !Array.isArray(value.ids) || value.ids.length === 0) return null;
  const ids = value.ids.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  if (ids.length !== value.ids.length) return null;

  const readOptionalIds = (key: "teamIds" | "projectIds"): readonly string[] | undefined => {
    const candidate = value[key];
    if (candidate === undefined) return undefined;
    if (!Array.isArray(candidate)) return undefined;
    const entries = candidate.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    return entries.length === candidate.length ? entries : undefined;
  };

  const teamIds = readOptionalIds("teamIds");
  const projectIds = readOptionalIds("projectIds");
  if ((value.teamIds !== undefined && teamIds === undefined) || (value.projectIds !== undefined && projectIds === undefined)) {
    return null;
  }
  return { ids, ...(teamIds ? { teamIds } : {}), ...(projectIds ? { projectIds } : {}) };
}

function scopeIsWithinPrincipal(sourceScope: SourceScope, principalScope: readonly string[]): boolean {
  if (principalScope.includes("*")) return true;
  return sourceScope.ids.every((id) => principalScope.includes(id));
}

function scopeOverlapsPrincipal(sourceScope: SourceScope, principalScope: readonly string[]): boolean {
  if (principalScope.includes("*")) return true;
  return sourceScope.ids.some((id) => principalScope.includes(id));
}

function safeConfiguration(value: unknown): JsonObject {
  if (value === undefined) return {};
  if (!isRecord(value)) throw sourceServiceError("INVALID_SOURCE_CONFIGURATION", "configuration must be an object.");
  const inspect = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      for (const item of entry) inspect(item);
      return;
    }
    if (!isRecord(entry)) return;
    for (const [key, child] of Object.entries(entry)) {
      if (/token|secret|password|credential|private[_-]?key/i.test(key)) {
        throw sourceServiceError("SECRET_IN_SOURCE_CONFIGURATION", "Credentials must be stored in Secret Manager, not source configuration.");
      }
      inspect(child);
    }
  };
  inspect(value);
  return value;
}

function assertSafeArtifactReference(value: string | undefined): void {
  if (value === undefined) return;
  if (value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value) || !/^(artifact|gs):\/\/[^\s]+$/i.test(value)) {
    throw sourceServiceError("INVALID_ARTIFACT_REFERENCE", "artifactRef must be an artifact:// or gs:// reference.");
  }
}

function toKnowledgeSource(row: typeof knowledgeSources.$inferSelect): KnowledgeSource {
  return {
    contractVersion: ContractVersion.KnowledgeSource,
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    kind: row.kind,
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.integrationId ? { integrationId: row.integrationId } : {}),
    status: row.status,
    readScope: row.readScope,
    visibilityScope: row.visibilityScope,
    ...(row.contentType ? { contentType: row.contentType } : {}),
    ...(row.currentRevisionId ? { currentRevisionId: row.currentRevisionId } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSourceRevision(row: typeof sourceRevisions.$inferSelect): SourceRevision {
  return {
    contractVersion: ContractVersion.SourceRevision,
    id: row.id,
    sourceId: row.sourceId,
    organizationId: row.organizationId,
    revision: row.revision,
    status: row.status,
    ...(row.artifactRef ? { artifactRef: row.artifactRef } : {}),
    ...(row.sourceObjectId ? { sourceObjectId: row.sourceObjectId } : {}),
    ...(row.contentType ? { contentType: row.contentType } : {}),
    ...(row.checksum ? { checksum: row.checksum } : {}),
    ...(row.observedAt ? { observedAt: row.observedAt.toISOString() } : {}),
    ...(row.ingestedAt ? { ingestedAt: row.ingestedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

async function hasKnowledgePermission(
  db: QueryDatabase,
  principal: AosPrincipal,
  permission: "knowledge:read" | "knowledge:manage",
): Promise<boolean> {
  const userId = localUserId(principal);
  if (!userId) return false;
  const [row] = await db
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, organizationMemberships.roleId))
    .where(
      and(
        eq(organizationMemberships.organizationId, principal.organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, "active"),
        or(eq(rolePermissions.permission, permission), eq(rolePermissions.permission, "knowledge:manage")),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function assertPermission(
  db: QueryDatabase,
  principal: AosPrincipal,
  permission: "knowledge:read" | "knowledge:manage",
): Promise<void> {
  if (!(await hasKnowledgePermission(db, principal, permission))) {
    throw sourceServiceError("FORBIDDEN", "The user is not allowed to manage Knowledge Sources.");
  }
}

function assertSourceKind(request: KnowledgeSourceCreateRequest): void {
  if (request.kind === KnowledgeSourceKind.Integration) {
    if (!request.provider || !request.integrationId) {
      throw sourceServiceError("INTEGRATION_REFERENCE_REQUIRED", "Integration sources require provider and integrationId.");
    }
    return;
  }
  if (request.integrationId || request.provider) {
    throw sourceServiceError("INVALID_SOURCE_REFERENCE", "Only integration sources may reference an integration provider.");
  }
  if (request.kind === KnowledgeSourceKind.UploadedDocument && request.contentType) {
    const allowed = new Set(["application/pdf", "text/plain", "text/markdown"]);
    if (!allowed.has(request.contentType)) {
      throw sourceServiceError("UNSUPPORTED_DOCUMENT_TYPE", "MVP uploaded documents support PDF, TXT, and Markdown.");
    }
  }
}

export async function createKnowledgeSource(
  principal: AosPrincipal,
  request: KnowledgeSourceCreateRequest,
): Promise<KnowledgeSource> {
  if (!database) throw sourceServiceError("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  if (!request.name || request.name.trim().length > 120) throw sourceServiceError("INVALID_SOURCE_NAME", "A source name is required and must be at most 120 characters.");
  const readScope = toScope(request.readScope);
  const visibilityScope = toScope(request.visibilityScope);
  if (!readScope || !visibilityScope) throw sourceServiceError("INVALID_SOURCE_SCOPE", "readScope and visibilityScope require non-empty ids.");
  if (!scopeIsWithinPrincipal(readScope, principal.scope) || !scopeIsWithinPrincipal(visibilityScope, principal.scope)) {
    throw sourceServiceError("SCOPE_DENIED", "A source scope cannot exceed the caller's scope.");
  }
  assertSourceKind(request);
  const configuration = safeConfiguration(request.configuration);

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    await assertPermission(db, principal, "knowledge:manage");
    if (request.kind === KnowledgeSourceKind.Integration) {
      const [integration] = await db
        .select({ provider: integrations.provider })
        .from(integrations)
        .where(and(eq(integrations.id, request.integrationId!), eq(integrations.organizationId, principal.organizationId)))
        .limit(1);
      if (!integration) throw sourceServiceError("INTEGRATION_NOT_FOUND", "The referenced integration was not found.");
      if (integration.provider !== request.provider) throw sourceServiceError("INTEGRATION_PROVIDER_MISMATCH", "The source provider does not match the integration.");
    }

    const [row] = await db
      .insert(knowledgeSources)
      .values({
        organizationId: principal.organizationId,
        name: request.name.trim(),
        kind: request.kind,
        provider: request.provider,
        integrationId: request.integrationId,
        readScope,
        visibilityScope,
        contentType: request.contentType,
        configuration,
      })
      .returning();
    if (!row) throw sourceServiceError("SOURCE_CREATE_FAILED", "The Knowledge Source could not be created.");
    return toKnowledgeSource(row);
  });
}

export async function listKnowledgeSources(principal: AosPrincipal): Promise<readonly KnowledgeSource[]> {
  if (!database) throw sourceServiceError("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  return withOrganizationContext(database, principal.organizationId, async (db) => {
    await assertPermission(db, principal, "knowledge:read");
    const rows = await db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.organizationId, principal.organizationId));
    return rows.filter((row) => scopeOverlapsPrincipal(row.readScope, principal.scope)).map(toKnowledgeSource);
  });
}

export async function getKnowledgeSource(
  principal: AosPrincipal,
  sourceId: string,
): Promise<SourceSummary | null> {
  if (!database) throw sourceServiceError("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  return withOrganizationContext(database, principal.organizationId, async (db) => {
    await assertPermission(db, principal, "knowledge:read");
    const [row] = await db
      .select()
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.organizationId, principal.organizationId)))
      .limit(1);
    if (!row || !scopeOverlapsPrincipal(row.readScope, principal.scope)) return null;
    const revisions = await db
      .select()
      .from(sourceRevisions)
      .where(and(eq(sourceRevisions.sourceId, sourceId), eq(sourceRevisions.organizationId, principal.organizationId)));
    return { source: toKnowledgeSource(row), revisions: revisions.map(toSourceRevision) };
  });
}

export async function createSourceRevision(
  principal: AosPrincipal,
  sourceId: string,
  request: SourceRevisionCreateRequest,
): Promise<SourceRevision | null> {
  if (!database) throw sourceServiceError("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  if (!request.revision || request.revision.length > 128) throw sourceServiceError("INVALID_SOURCE_REVISION", "A revision identifier is required and must be at most 128 characters.");
  assertSafeArtifactReference(request.artifactRef);
  return withOrganizationContext(database, principal.organizationId, async (db) => {
    await assertPermission(db, principal, "knowledge:manage");
    const [source] = await db
      .select()
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.organizationId, principal.organizationId)))
      .limit(1);
    if (!source || !scopeIsWithinPrincipal(source.readScope, principal.scope)) return null;
    const [row] = await db
      .insert(sourceRevisions)
      .values({
        organizationId: principal.organizationId,
        sourceId,
        revision: request.revision,
        artifactRef: request.artifactRef,
        sourceObjectId: request.sourceObjectId,
        contentType: request.contentType ?? source.contentType,
        checksum: request.checksum,
        observedAt: request.observedAt ? new Date(request.observedAt) : undefined,
      })
      .returning();
    if (!row) throw sourceServiceError("SOURCE_REVISION_CREATE_FAILED", "The source revision could not be created.");
    await db
      .update(knowledgeSources)
      .set({ currentRevisionId: row.id, status: KnowledgeSourceStatus.Draft, updatedAt: new Date() })
      .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.organizationId, principal.organizationId)));
    return toSourceRevision(row);
  });
}

function sourceIngestionInput(
  principal: AosPrincipal,
  source: KnowledgeSource,
  revision: SourceRevision,
  trigger: SourceIngestionTrigger,
  requestId: string,
  traceId: string,
  workflowId: string,
  policyVersion: string,
): SourceIngestionRequest {
  return {
    contractVersion: ContractVersion.SourceIngestion,
    actorId: principal.actorId,
    organizationId: principal.organizationId,
    requestId,
    traceId,
    workflowId,
    policyVersion,
    scope: source.readScope,
    sourceId: source.id,
    sourceRevisionId: revision.id,
    sourceKind: source.kind,
    ...(source.provider ? { provider: source.provider } : {}),
    ...(revision.artifactRef ? { artifactRef: revision.artifactRef } : {}),
    ...(revision.sourceObjectId ? { sourceObjectId: revision.sourceObjectId } : {}),
    ...(revision.contentType ? { contentType: revision.contentType } : {}),
    trigger,
    readScope: source.readScope,
    visibilityScope: source.visibilityScope,
  };
}

export async function startSourceIngestion(
  principal: AosPrincipal,
  sourceId: string,
  revisionId: string,
  trigger: SourceIngestionTrigger,
  requestId: string,
  traceId: string,
  options: SourceServiceOptions,
): Promise<SourceIngestionLaunch> {
  if (!database) throw sourceServiceError("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  const userId = localUserId(principal);
  if (!userId) throw sourceServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");
  const workflowId = buildWorkflowId({
    organizationId: principal.organizationId,
    workflowType: "encois.source-ingestion.v1",
    key: `${sourceId}:${revisionId}`,
  });

  const requestHash = createHash("sha256").update(JSON.stringify({ sourceId, revisionId, trigger })).digest("hex");
  const prepared = await withOrganizationContext(database, principal.organizationId, async (db) => {
    await assertPermission(db, principal, "knowledge:manage");
    const [sourceRow] = await db
      .select()
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.organizationId, principal.organizationId)))
      .limit(1);
    const [revisionRow] = await db
      .select()
      .from(sourceRevisions)
      .where(and(eq(sourceRevisions.id, revisionId), eq(sourceRevisions.sourceId, sourceId), eq(sourceRevisions.organizationId, principal.organizationId)))
      .limit(1);
    if (!sourceRow || !revisionRow || !scopeIsWithinPrincipal(sourceRow.readScope, principal.scope)) {
      throw sourceServiceError("SOURCE_NOT_FOUND", "Source or revision not found.");
    }

    const source = toKnowledgeSource(sourceRow);
    const revision = toSourceRevision(revisionRow);
    const input = sourceIngestionInput(principal, source, revision, trigger, requestId, traceId, workflowId, options.policyVersion);
    const [existing] = await db
      .select()
      .from(sourceIngestionRuns)
      .where(and(eq(sourceIngestionRuns.organizationId, principal.organizationId), eq(sourceIngestionRuns.temporalWorkflowId, workflowId)))
      .limit(1);
    if (existing) {
      return {
        source,
        revision,
        existingStatus: existing.status,
        existingRunId: existing.temporalRunId ?? undefined,
        reused: true as const,
      };
    }

    const [createdRun] = await db.insert(sourceIngestionRuns).values({
      organizationId: principal.organizationId,
      sourceId,
      sourceRevisionId: revisionId,
      temporalWorkflowId: workflowId,
      trigger,
      status: "queued",
      currentStage: "acquired",
    }).onConflictDoNothing().returning({ id: sourceIngestionRuns.id });
    if (!createdRun) {
      const [raced] = await db
        .select({ status: sourceIngestionRuns.status, temporalRunId: sourceIngestionRuns.temporalRunId })
        .from(sourceIngestionRuns)
        .where(and(eq(sourceIngestionRuns.organizationId, principal.organizationId), eq(sourceIngestionRuns.temporalWorkflowId, workflowId)))
        .limit(1);
      if (!raced) throw sourceServiceError("SOURCE_INGESTION_CONFLICT", "The source ingestion run could not be claimed.");
      return {
        source,
        revision,
        existingStatus: raced.status,
        existingRunId: raced.temporalRunId ?? undefined,
        reused: true as const,
      };
    }
    await db.update(knowledgeSources).set({ status: "ingesting", updatedAt: new Date() }).where(eq(knowledgeSources.id, sourceId));
    await db.update(sourceRevisions).set({ status: "ingesting" }).where(eq(sourceRevisions.id, revisionId));
    return { source, revision, input, requestHash, reused: false as const };
  });

  if (prepared.reused) {
    const projection = await options.workflowClient.get(workflowId, principal.organizationId, options.namespace);
    const runId = projection?.runId ?? prepared.existingRunId;
    return {
      source: prepared.source,
      revision: prepared.revision,
      workflow: {
        workflowId,
        ...(runId ? { runId } : {}),
        status: projection?.status ?? prepared.existingStatus,
        reused: true,
      },
      resultContract: ContractVersion.SourceIngestionResult,
    };
  }

  let projection;
  try {
    projection = await options.workflowClient.start(
      {
        workflowType: "encois.source-ingestion.v1",
        workflowId,
        taskQueue: options.taskQueue,
        input: prepared.input,
        requestHash: prepared.requestHash,
      },
      options.namespace,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source ingestion could not be started.";
    await withOrganizationContext(database, principal.organizationId, async (db) => {
      await db.update(sourceIngestionRuns).set({ status: "failed", error: message.slice(0, 2000), completedAt: new Date(), updatedAt: new Date() }).where(and(eq(sourceIngestionRuns.organizationId, principal.organizationId), eq(sourceIngestionRuns.temporalWorkflowId, workflowId)));
      await db.update(knowledgeSources).set({ status: "failed", updatedAt: new Date() }).where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.organizationId, principal.organizationId)));
      await db.update(sourceRevisions).set({ status: "failed" }).where(and(eq(sourceRevisions.id, revisionId), eq(sourceRevisions.organizationId, principal.organizationId)));
    });
    throw sourceServiceError("SOURCE_INGESTION_START_FAILED", message);
  }

  await withOrganizationContext(database, principal.organizationId, async (db) => {
    await db
      .update(sourceIngestionRuns)
      .set({
        temporalRunId: projection.runId,
        status:
          projection.status === "failed"
            ? "failed"
            : projection.status === "completed"
              ? "completed"
              : projection.status === "queued"
                ? "queued"
                : "running",
        startedAt: projection.status === "queued" ? undefined : new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(sourceIngestionRuns.organizationId, principal.organizationId), eq(sourceIngestionRuns.temporalWorkflowId, workflowId)));
  });
  return {
    source: { ...prepared.source, status: KnowledgeSourceStatus.Ingesting, updatedAt: new Date().toISOString() },
    revision: { ...prepared.revision, status: SourceRevisionStatus.Ingesting },
    workflow: projection,
    resultContract: ContractVersion.SourceIngestionResult,
  };
}

export function parseSourceScope(value: unknown): ExecutionScope | null {
  return toScope(value);
}
