import { and, asc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  ContractVersion,
  FreshnessStatus,
  KnowledgeSourceKind,
  KnowledgeSourceStatus,
  Permission,
  SourceIngestionTrigger,
  SourceRevisionStatus,
  isJsonObject,
  type ExecutionScope,
  type JsonObject,
  type KnowledgeSource,
  type KnowledgeSourceCreateRequest,
  type SourceIngestionRun,
  type SourceIngestionResult,
  type SourceIngestionRequest,
  type SourceRevision,
  type SourceRevisionCreateRequest,
  type SourceFreshness,
} from "@encois/contracts";
import {
  integrations,
  integrationBindings,
  knowledgeSources,
  sourceIngestionRuns,
  sourceRevisions,
  withOrganizationContext,
  type PersistenceTransaction,
  type SourceScope,
} from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { database } from "../../database.js";
import { hasPermission } from "../../auth/authorization.js";
import { createExecutionCapability } from "../../security/execution-capability.js";
import type { WorkflowClient, WorkflowResultReader } from "../../workflows/temporal-client.js";
import { buildWorkflowId } from "../../workflows/types.js";

type QueryDatabase = NonNullable<typeof database> | PersistenceTransaction;

export type SourceServiceError = Error & { code: string };

export type SourceSummary = {
  source: KnowledgeSource;
  revisions: readonly SourceRevision[];
  ingestionRuns: readonly SourceIngestionRun[];
};

export type UploadedPdfSourceInput = {
  name: string;
  fileName: string;
  bytes: Uint8Array;
  readScope?: ExecutionScope;
  visibilityScope?: ExecutionScope;
};

export type SourceArtifactStore = {
  reference(input: { organizationId: string; sourceId: string; revision: string }): { artifactRef: string; objectKey: string };
  write(input: {
    artifactRef: string;
    objectKey: string;
    organizationId: string;
    sourceId: string;
    revision: string;
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<void>;
  remove?(input: { artifactRef: string; objectKey: string }): Promise<void>;
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
  capabilitySecret?: string;
  capabilityTtlMs?: number;
  /** Internal ingestion triggers use a system actor, never a browser principal. */
  system?: boolean;
};

export type SourceMutationOptions = {
  /** Only trusted server-side callers may set this. User routes never pass it. */
  system?: boolean;
};

function isSourceIngestionResult(value: unknown): value is SourceIngestionResult {
  if (!isJsonObject(value)) return false;
  return value.contractVersion === ContractVersion.SourceIngestionResult &&
    typeof value.requestId === "string" && typeof value.sourceId === "string" &&
    typeof value.sourceRevisionId === "string" && typeof value.status === "string" &&
    typeof value.stage === "string" && typeof value.factsCount === "number" && Array.isArray(value.evidenceRefs);
}

async function reconcileSourceIngestion(
  db: QueryDatabase,
  principal: AosPrincipal,
  run: typeof sourceIngestionRuns.$inferSelect,
  options: SourceServiceOptions,
): Promise<void> {
  let projection;
  try {
    projection = await options.workflowClient.get(run.temporalWorkflowId, principal.organizationId, options.namespace);
  } catch {
    return;
  }
  if (!projection || projection.status !== "completed") return;
  const reader = options.workflowClient as unknown as WorkflowResultReader;
  if (typeof reader.GetResult !== "function") return;
  const rawResult = await reader.GetResult(run.temporalWorkflowId, principal.organizationId, options.namespace).catch(() => null);
  if (!isSourceIngestionResult(rawResult)) return;
  const nextStatus = rawResult.status === "completed" || rawResult.status === "deferred" || rawResult.status === "failed" ? rawResult.status : "failed";
  const completed = nextStatus === "completed";
  await db.update(sourceIngestionRuns).set({
    status: nextStatus,
    currentStage: rawResult.stage,
    factsCount: rawResult.factsCount,
    error: nextStatus === "failed" ? (rawResult.message ?? "Source ingestion failed.").slice(0, 2000) : null,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(sourceIngestionRuns.id, run.id), eq(sourceIngestionRuns.organizationId, principal.organizationId)));
  await db.update(sourceRevisions).set({
    status: completed ? SourceRevisionStatus.Active : SourceRevisionStatus.Failed,
    ingestedAt: completed ? new Date() : undefined,
  }).where(and(eq(sourceRevisions.id, run.sourceRevisionId), eq(sourceRevisions.organizationId, principal.organizationId)));
  await db.update(knowledgeSources).set({
    status: completed ? KnowledgeSourceStatus.Active : nextStatus === "deferred" ? KnowledgeSourceStatus.Degraded : KnowledgeSourceStatus.Failed,
    updatedAt: new Date(),
  }).where(and(eq(knowledgeSources.id, run.sourceId), eq(knowledgeSources.organizationId, principal.organizationId)));
}

export function sourceServiceError(code: string, message: string): SourceServiceError {
  const error = new Error(message) as SourceServiceError;
  error.code = code;
  return error;
}

export function isSourceServiceError(error: unknown): error is SourceServiceError {
  return error instanceof Error && typeof (error as Partial<SourceServiceError>).code === "string";
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

function localUserId(principal: AosPrincipal): string | null {
  const candidate = principal.userId ?? principal.actorId;
  return /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null;
}

function toScope(value: unknown): SourceScope | null {
  if (!isJsonObject(value) || !Array.isArray(value.ids) || value.ids.length === 0) return null;
  const ids = [...new Set(value.ids.filter((entry): entry is string => typeof entry === "string" && entry.length > 0))];
  if (ids.length !== value.ids.length) return null;

  if (Object.keys(value).some((key) => key !== "ids")) return null;
  return { ids };
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
  if (!isJsonObject(value)) throw sourceServiceError("INVALID_SOURCE_CONFIGURATION", "configuration must be an object.");
  const inspect = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      for (const item of entry) inspect(item);
      return;
    }
    if (!isJsonObject(entry)) return;
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

const sourceFreshnessMaxAgeMs = {
  integration: 24 * 60 * 60 * 1000,
  default: 30 * 24 * 60 * 60 * 1000,
} as const;

function toSourceFreshness(
  source: typeof knowledgeSources.$inferSelect,
  revision: typeof sourceRevisions.$inferSelect | undefined,
  now = Date.now(),
): SourceFreshness | undefined {
  if (!revision?.observedAt || !revision.ingestedAt) return undefined;
  const maxAge = source.kind === KnowledgeSourceKind.Integration ? sourceFreshnessMaxAgeMs.integration : sourceFreshnessMaxAgeMs.default;
  const expiresAt = new Date(revision.ingestedAt.getTime() + maxAge);
  return {
    source: source.provider ?? source.kind,
    observedAt: revision.observedAt.toISOString(),
    ingestedAt: revision.ingestedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: now <= expiresAt.getTime() ? FreshnessStatus.Fresh : FreshnessStatus.Stale,
  };
}

function toKnowledgeSource(row: typeof knowledgeSources.$inferSelect, freshness?: SourceFreshness): KnowledgeSource {
  return {
    contractVersion: ContractVersion.KnowledgeSource,
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    kind: row.kind,
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.integrationId ? { integrationId: row.integrationId } : {}),
    status: row.status,
    readScope: { ids: row.readScope.ids },
    visibilityScope: { ids: row.visibilityScope.ids },
    ...(row.contentType ? { contentType: row.contentType } : {}),
    ...(row.currentRevisionId ? { currentRevisionId: row.currentRevisionId } : {}),
    ...(freshness ? { freshness } : {}),
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
    ...(Object.keys(row.metadata).length > 0 ? { metadata: row.metadata } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

function toSourceIngestionRun(row: typeof sourceIngestionRuns.$inferSelect): SourceIngestionRun {
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceRevisionId: row.sourceRevisionId,
    temporalWorkflowId: row.temporalWorkflowId,
    ...(row.temporalRunId ? { temporalRunId: row.temporalRunId } : {}),
    trigger: row.trigger,
    status: row.status,
    ...(row.currentStage ? { currentStage: row.currentStage } : {}),
    factsCount: row.factsCount,
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.createdAt.toISOString(),
    ...(row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function hasKnowledgePermission(
  db: QueryDatabase,
  principal: AosPrincipal,
  permission: typeof Permission.KnowledgeRead | typeof Permission.KnowledgeManage,
): Promise<boolean> {
  return hasPermission(db, principal, permission);
}

async function assertPermission(
  db: QueryDatabase,
  principal: AosPrincipal,
  permission: typeof Permission.KnowledgeRead | typeof Permission.KnowledgeManage,
): Promise<void> {
  if (!(await hasKnowledgePermission(db, principal, permission))) {
    throw sourceServiceError("FORBIDDEN", permission === Permission.KnowledgeRead ? "The user is not allowed to read Knowledge Sources." : "The user is not allowed to manage Knowledge Sources.");
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
    await assertPermission(db, principal, Permission.KnowledgeManage);
    if (request.kind === KnowledgeSourceKind.Integration) {
      const [integration] = await db
        .select({ provider: integrations.provider, status: integrations.status, credentialRef: integrations.credentialRef })
        .from(integrations)
        .where(and(eq(integrations.id, request.integrationId!), eq(integrations.organizationId, principal.organizationId)))
        .limit(1);
      if (!integration) throw sourceServiceError("INTEGRATION_NOT_FOUND", "The referenced integration was not found.");
      if (integration.provider !== request.provider) throw sourceServiceError("INTEGRATION_PROVIDER_MISMATCH", "The source provider does not match the integration.");
      if (integration.status !== "active") throw sourceServiceError("INTEGRATION_NOT_ACTIVE", "The referenced integration is not active.");
      if (!integration.credentialRef) throw sourceServiceError("INTEGRATION_CREDENTIAL_REQUIRED", "The referenced integration has no configured provider credential.");
      const [binding] = await db
        .select({ id: integrationBindings.id })
        .from(integrationBindings)
        .where(and(
          eq(integrationBindings.integrationId, request.integrationId!),
          eq(integrationBindings.organizationId, principal.organizationId),
          eq(integrationBindings.status, "active"),
          inArray(integrationBindings.organizationUnitId, readScope.ids),
        ))
        .limit(1);
      if (!binding) throw sourceServiceError("INTEGRATION_SCOPE_UNAVAILABLE", "The Integration has no active binding in the requested read scope.");
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
    await assertPermission(db, principal, Permission.KnowledgeRead);
    const rows = await db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.organizationId, principal.organizationId));
    const visibleRows = rows.filter((row) => scopeOverlapsPrincipal(row.readScope, principal.scope) && scopeOverlapsPrincipal(row.visibilityScope, principal.scope));
    if (visibleRows.length === 0) return [];
    const revisions = await db
      .select()
      .from(sourceRevisions)
      .where(inArray(sourceRevisions.sourceId, visibleRows.map((row) => row.id)))
      .orderBy(asc(sourceRevisions.createdAt));
    const latestBySource = new Map<string, typeof revisions[number]>();
    for (const revision of revisions) latestBySource.set(revision.sourceId, revision);
    return visibleRows.map((row) => toKnowledgeSource(row, toSourceFreshness(row, latestBySource.get(row.id))));
  });
}

export async function getKnowledgeSource(
  principal: AosPrincipal,
  sourceId: string,
  options?: SourceServiceOptions,
): Promise<SourceSummary | null> {
  if (!database) throw sourceServiceError("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  return withOrganizationContext(database, principal.organizationId, async (db) => {
    await assertPermission(db, principal, Permission.KnowledgeRead);
    const [row] = await db
      .select()
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.organizationId, principal.organizationId)))
      .limit(1);
    if (!row || !scopeOverlapsPrincipal(row.readScope, principal.scope) || !scopeOverlapsPrincipal(row.visibilityScope, principal.scope)) return null;
    const revisions = await db
      .select()
      .from(sourceRevisions)
      .where(and(eq(sourceRevisions.sourceId, sourceId), eq(sourceRevisions.organizationId, principal.organizationId)))
      .orderBy(asc(sourceRevisions.createdAt));
    let ingestionRuns = await db
      .select()
      .from(sourceIngestionRuns)
      .where(and(eq(sourceIngestionRuns.sourceId, sourceId), eq(sourceIngestionRuns.organizationId, principal.organizationId)))
      .orderBy(asc(sourceIngestionRuns.createdAt));
    if (options) {
      for (const run of ingestionRuns) {
        if (run.status === "queued" || run.status === "running") await reconcileSourceIngestion(db, principal, run, options);
      }
      ingestionRuns = await db
        .select()
        .from(sourceIngestionRuns)
        .where(and(eq(sourceIngestionRuns.sourceId, sourceId), eq(sourceIngestionRuns.organizationId, principal.organizationId)))
        .orderBy(asc(sourceIngestionRuns.createdAt));
    }
    const [freshSource] = options
      ? await db.select().from(knowledgeSources).where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.organizationId, principal.organizationId))).limit(1)
      : [row];
    const freshRevisions = options
      ? await db.select().from(sourceRevisions).where(and(eq(sourceRevisions.sourceId, sourceId), eq(sourceRevisions.organizationId, principal.organizationId))).orderBy(asc(sourceRevisions.createdAt))
      : revisions;
    const effectiveSource = freshSource ?? row;
    const latestRevision = freshRevisions[freshRevisions.length - 1];
    return { source: toKnowledgeSource(effectiveSource, toSourceFreshness(effectiveSource, latestRevision)), revisions: freshRevisions.map(toSourceRevision), ingestionRuns: ingestionRuns.map(toSourceIngestionRun) };
  });
}

export async function createSourceRevision(
  principal: AosPrincipal,
  sourceId: string,
  request: SourceRevisionCreateRequest,
  options: SourceMutationOptions = {},
): Promise<SourceRevision | null> {
  if (!database) throw sourceServiceError("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  if (!request.revision || request.revision.length > 128) throw sourceServiceError("INVALID_SOURCE_REVISION", "A revision identifier is required and must be at most 128 characters.");
  assertSafeArtifactReference(request.artifactRef);
  const metadata = safeConfiguration(request.metadata);
  return withOrganizationContext(database, principal.organizationId, async (db) => {
    if (!options.system) await assertPermission(db, principal, Permission.KnowledgeManage);
    const [source] = await db
      .select()
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.organizationId, principal.organizationId)))
      .limit(1);
    if (!source || !scopeIsWithinPrincipal(source.readScope, principal.scope) || !scopeIsWithinPrincipal(source.visibilityScope, principal.scope)) return null;
    const [existing] = await db
      .select({ id: sourceRevisions.id })
      .from(sourceRevisions)
      .where(and(eq(sourceRevisions.sourceId, sourceId), eq(sourceRevisions.organizationId, principal.organizationId), eq(sourceRevisions.revision, request.revision)))
      .limit(1);
    if (existing) {
      if (!options.system) throw sourceServiceError("SOURCE_REVISION_CONFLICT", "This source revision already exists.");
      const [existingRow] = await db
        .select()
        .from(sourceRevisions)
        .where(and(eq(sourceRevisions.id, existing.id), eq(sourceRevisions.organizationId, principal.organizationId)))
        .limit(1);
      return existingRow ? toSourceRevision(existingRow) : null;
    }
    let row: typeof sourceRevisions.$inferSelect | undefined;
    try {
      [row] = await db
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
          metadata,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (options.system) {
          const [existingRow] = await db
            .select()
            .from(sourceRevisions)
            .where(and(eq(sourceRevisions.sourceId, sourceId), eq(sourceRevisions.organizationId, principal.organizationId), eq(sourceRevisions.revision, request.revision)))
            .limit(1);
          return existingRow ? toSourceRevision(existingRow) : null;
        }
        throw sourceServiceError("SOURCE_REVISION_CONFLICT", "This source revision already exists.");
      }
      throw error;
    }
    if (!row) throw sourceServiceError("SOURCE_REVISION_CREATE_FAILED", "The source revision could not be created.");
    await db
      .update(knowledgeSources)
      .set({ currentRevisionId: row.id, status: KnowledgeSourceStatus.Draft, updatedAt: new Date() })
      .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.organizationId, principal.organizationId)));
    return toSourceRevision(row);
  });
}

function pdfFileName(value: string): string {
  const normalized = value.replace(/[\\/\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240);
  return normalized.toLowerCase().endsWith(".pdf") ? normalized : `${normalized || "document"}.pdf`;
}

export async function uploadPdfKnowledgeSource(
  principal: AosPrincipal,
  input: UploadedPdfSourceInput,
  artifactStore: SourceArtifactStore | undefined,
): Promise<{ source: KnowledgeSource; revision: SourceRevision }> {
  if (!artifactStore) throw sourceServiceError("ARTIFACT_STORE_UNAVAILABLE", "PDF uploads are not configured for this environment.");
  const fileName = pdfFileName(input.fileName);
  if (!input.name.trim() || input.name.trim().length > 120) {
    throw sourceServiceError("INVALID_SOURCE_NAME", "A source name is required and must be at most 120 characters.");
  }
  if (input.bytes.length === 0 || input.bytes.length > 10 * 1024 * 1024) {
    throw sourceServiceError("INVALID_UPLOAD_SIZE", "PDF uploads must be between 1 byte and 10 MiB.");
  }
  const header = new TextDecoder().decode(input.bytes.subarray(0, 5));
  if (header !== "%PDF-") throw sourceServiceError("INVALID_PDF", "The uploaded file is not a valid PDF signature.");

  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const revision = `sha256-${checksum}`;
  const source = await createKnowledgeSource(principal, {
    name: input.name.trim(),
    kind: KnowledgeSourceKind.UploadedDocument,
    readScope: input.readScope ?? { ids: principal.scope },
    visibilityScope: input.visibilityScope ?? { ids: principal.scope },
    contentType: "application/pdf",
  });
  const reference = artifactStore.reference({ organizationId: principal.organizationId, sourceId: source.id, revision });

  try {
    await artifactStore.write({
      artifactRef: reference.artifactRef,
      objectKey: reference.objectKey,
      organizationId: principal.organizationId,
      sourceId: source.id,
      revision,
      fileName,
      contentType: "application/pdf",
      bytes: input.bytes,
    });
    const revisionProjection = await createSourceRevision(principal, source.id, {
      revision,
      artifactRef: reference.artifactRef,
      sourceObjectId: reference.objectKey,
      contentType: "application/pdf",
      checksum,
      observedAt: new Date().toISOString(),
      metadata: { fileName, sizeBytes: input.bytes.length },
    });
    if (!revisionProjection) throw sourceServiceError("SOURCE_NOT_FOUND", "The uploaded source could not be completed.");
    return { source: { ...source, currentRevisionId: revisionProjection.id }, revision: revisionProjection };
  } catch (error) {
    if (artifactStore.remove) {
      await artifactStore.remove(reference).catch(() => undefined);
    }
    throw error;
  }
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
  capabilitySecret: string,
  capabilityTtlMs: number | undefined,
): SourceIngestionRequest {
  const scope = { ids: [...new Set(source.readScope.ids)].sort() };
  return {
    contractVersion: ContractVersion.SourceIngestion,
    actorId: principal.actorId,
    organizationId: principal.organizationId,
    requestId,
    traceId,
    workflowId,
    policyVersion,
    scope,
    capability: createExecutionCapability({
      secret: capabilitySecret,
      organizationId: principal.organizationId,
      workflowId,
      actorId: principal.actorId,
      policyVersion,
      scope,
      ttlMs: capabilityTtlMs,
    }),
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
  if (!options.system) {
    const userId = localUserId(principal);
    if (!userId) throw sourceServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");
  }
  const workflowId = buildWorkflowId({
    organizationId: principal.organizationId,
    workflowType: "encois.source-ingestion.v1",
    key: `${sourceId}:${revisionId}`,
  });

  const requestHash = createHash("sha256").update(JSON.stringify({ sourceId, revisionId, trigger })).digest("hex");
  const prepared = await withOrganizationContext(database, principal.organizationId, async (db) => {
    if (!options.system) await assertPermission(db, principal, Permission.KnowledgeManage);
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
    if (!sourceRow || !revisionRow || !scopeIsWithinPrincipal(sourceRow.readScope, principal.scope) || !scopeIsWithinPrincipal(sourceRow.visibilityScope, principal.scope)) {
      throw sourceServiceError("SOURCE_NOT_FOUND", "Source or revision not found.");
    }

    const source = toKnowledgeSource(sourceRow);
    const revision = toSourceRevision(revisionRow);
    if (!options.capabilitySecret) throw sourceServiceError("CAPABILITY_NOT_CONFIGURED", "Execution capability signing is not configured.");
    const input = sourceIngestionInput(principal, source, revision, trigger, requestId, traceId, workflowId, options.policyVersion, options.capabilitySecret, options.capabilityTtlMs);
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
