import { and, desc, eq, inArray } from "drizzle-orm";
import { IntegrationStatus, KnowledgeSourceStatus, Permission, WorkflowExecutionStatus, isJsonObject, type NotificationPreferences, type NotificationProjection } from "@encois/contracts";
import { integrations, integrationBindings, knowledgeSources, notificationPreferences, notifications, sourceIngestionRuns, sourceRevisions, workflowRuns, withOrganizationContext, type PersistenceTransaction } from "@encois/persistence";
import { database } from "../database.js";
import type { AosPrincipal } from "../middleware/aos.js";
import { hasPermission } from "../auth/authorization.js";

export type NotificationServiceError = Error & { code: string };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function error(code: string, message: string): NotificationServiceError { const value = new Error(message) as NotificationServiceError; value.code = code; return value; }
export function isNotificationServiceError(value: unknown): value is NotificationServiceError { return value instanceof Error && typeof (value as Partial<NotificationServiceError>).code === "string"; }
function userId(principal: AosPrincipal): string { const value = principal.userId ?? principal.actorId; if (!/^[0-9a-f-]{36}$/i.test(value)) throw error("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user."); return value; }
export function organizationUnitIdsForPrincipal(principal: AosPrincipal): readonly string[] { return principal.scope.filter((scope) => UUID_PATTERN.test(scope)); }
export function unsupportedNotificationDeliveryRequested(input: NotificationPreferences): boolean { return input.emailEnabled || input.pushEnabled || input.weeklyDigest; }
function visibleScope(value: unknown, principal: AosPrincipal): boolean { if (principal.scope.includes("*")) return true; return isJsonObject(value) && Array.isArray(value.ids) && (value.ids as unknown[]).some((id) => typeof id === "string" && principal.scope.includes(id)); }
function toPreferences(row?: typeof notificationPreferences.$inferSelect): NotificationPreferences { return { emailEnabled: false, pushEnabled: false, workflowUpdates: row?.workflowUpdates ?? true, evidenceReady: row?.evidenceReady ?? true, weeklyDigest: false, ...(row ? { updatedAt: row.updatedAt.toISOString() } : {}) }; }
function toNotification(row: typeof notifications.$inferSelect): NotificationProjection { return { id: row.id, type: row.type, severity: row.severity as NotificationProjection["severity"], title: row.title, message: row.message, ...(row.resourceType ? { resourceType: row.resourceType } : {}), ...(row.resourceId ? { resourceId: row.resourceId } : {}), ...(row.readAt ? { readAt: row.readAt.toISOString() } : {}), createdAt: row.createdAt.toISOString() }; }
async function canReadNotifications(db: PersistenceTransaction, principal: AosPrincipal): Promise<boolean> { return (await hasPermission(db, principal, Permission.SettingsRead)) || (await hasPermission(db, principal, Permission.WorkflowsRead)) || (await hasPermission(db, principal, Permission.KnowledgeRead)); }

async function syncOperationalNotifications(db: PersistenceTransaction, principal: AosPrincipal, ownerUserId: string, preferences: NotificationPreferences): Promise<void> {
  const now = new Date();
  if (preferences.workflowUpdates) {
    const runs = await db.select().from(workflowRuns).where(eq(workflowRuns.organizationId, principal.organizationId));
    for (const run of runs) {
      const isRecentCompletion = run.status === WorkflowExecutionStatus.Completed && now.getTime() - run.updatedAt.getTime() <= 24 * 60 * 60 * 1000;
      if (!visibleScope(run.scope, principal) || (!new Set<string>([WorkflowExecutionStatus.Waiting, WorkflowExecutionStatus.Paused, WorkflowExecutionStatus.Partial, WorkflowExecutionStatus.Failed]).has(run.status) && !isRecentCompletion)) continue;
      const type = isRecentCompletion ? "workflow_completed" : run.status === WorkflowExecutionStatus.Waiting || run.status === WorkflowExecutionStatus.Paused ? "workflow_waiting" : "workflow_failed";
      await db.insert(notifications).values({ organizationId: principal.organizationId, userId: ownerUserId, type, severity: isRecentCompletion ? "info" : run.status === WorkflowExecutionStatus.Failed ? "error" : "warning", title: isRecentCompletion ? "Workflow run completed" : run.status === WorkflowExecutionStatus.Failed ? "Workflow run failed" : "Workflow run needs attention", message: isRecentCompletion ? `${run.temporalWorkflowId} completed and its evidence is ready to review.` : `${run.temporalWorkflowId} is ${run.status}. Review the Run before starting another execution.`, resourceType: "workflow_run", resourceId: run.temporalWorkflowId, dedupeKey: `workflow:${run.temporalWorkflowId}:${run.status}`, createdAt: now }).onConflictDoNothing();
    }
  }
  if (preferences.evidenceReady) {
    const sourceRows = await db.select().from(knowledgeSources).where(eq(knowledgeSources.organizationId, principal.organizationId));
    const sourceRevisionRows = await db.select().from(sourceRevisions).where(eq(sourceRevisions.organizationId, principal.organizationId)).orderBy(desc(sourceRevisions.createdAt));
    const latestRevisionBySource = new Map<string, typeof sourceRevisionRows[number]>();
    for (const revision of sourceRevisionRows) if (!latestRevisionBySource.has(revision.sourceId)) latestRevisionBySource.set(revision.sourceId, revision);
    for (const source of sourceRows) {
      if (!visibleScope(source.readScope, principal) || !visibleScope(source.visibilityScope, principal)) continue;
      const latest = latestRevisionBySource.get(source.id);
      const maxAge = source.kind === "integration" ? 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      const isStale = Boolean(latest?.ingestedAt && latest.ingestedAt.getTime() + maxAge < now.getTime());
      const needsAttention = new Set<string>([KnowledgeSourceStatus.Degraded, KnowledgeSourceStatus.NeedsReauth, KnowledgeSourceStatus.Failed]).has(source.status) || isStale;
      if (!needsAttention) continue;
      const attentionStatus = isStale && source.status === KnowledgeSourceStatus.Active ? "stale" : source.status;
      await db.insert(notifications).values({ organizationId: principal.organizationId, userId: ownerUserId, type: isStale ? "source_stale" : "source_attention", severity: source.status === KnowledgeSourceStatus.Failed ? "error" : "warning", title: isStale ? "Source is stale" : "Source needs attention", message: isStale ? `${source.name} has not been refreshed within the source freshness policy.` : `${source.name} is ${source.status.replace("_", " ")}. Evidence may be incomplete.`, resourceType: "knowledge_source", resourceId: source.id, dedupeKey: `source:${source.id}:${attentionStatus}`, createdAt: now }).onConflictDoNothing();
    }
    const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
    const failedIngestions = await db.select().from(sourceIngestionRuns).where(and(eq(sourceIngestionRuns.organizationId, principal.organizationId), eq(sourceIngestionRuns.status, "failed")));
    for (const ingestion of failedIngestions) {
      const source = sourceById.get(ingestion.sourceId);
      if (!source || !visibleScope(source.readScope, principal) || !visibleScope(source.visibilityScope, principal)) continue;
      await db.insert(notifications).values({ organizationId: principal.organizationId, userId: ownerUserId, type: "ingestion_failed", severity: "error", title: "Source ingestion failed", message: `${source.name} failed during ingestion. Review the Source run details.`, resourceType: "source_ingestion", resourceId: ingestion.id, dedupeKey: `ingestion:${ingestion.id}:failed`, createdAt: now }).onConflictDoNothing();
    }
    const integrationsRows = await db.select().from(integrations).where(eq(integrations.organizationId, principal.organizationId));
    const scopedUnitIds = organizationUnitIdsForPrincipal(principal);
    const accessibleBindingRows = principal.scope.includes("*")
      ? integrationsRows.map((row) => row.id)
      : scopedUnitIds.length === 0
        ? []
        : await db.select({ integrationId: integrationBindings.integrationId }).from(integrationBindings).where(and(eq(integrationBindings.organizationId, principal.organizationId), eq(integrationBindings.status, "active"), inArray(integrationBindings.organizationUnitId, scopedUnitIds)));
    const accessibleIntegrationIds = new Set(accessibleBindingRows.map((row) => typeof row === "string" ? row : row.integrationId));
    for (const integration of integrationsRows) {
      if (!accessibleIntegrationIds.has(integration.id) || !new Set<string>([IntegrationStatus.Pending, IntegrationStatus.Degraded, IntegrationStatus.NeedsReauth, IntegrationStatus.Error]).has(integration.status)) continue;
      await db.insert(notifications).values({ organizationId: principal.organizationId, userId: ownerUserId, type: "integration_attention", severity: integration.status === IntegrationStatus.Error ? "error" : "warning", title: "Integration needs attention", message: `${integration.displayName} is ${integration.status.replace("_", " ")}.`, resourceType: "integration", resourceId: integration.id, dedupeKey: `integration:${integration.id}:${integration.status}`, createdAt: now }).onConflictDoNothing();
    }
  }
}

export async function getNotificationPreferences(principal: AosPrincipal): Promise<NotificationPreferences> { if (!database) throw error("PERSISTENCE_UNAVAILABLE", "Database access is not configured."); const ownerUserId = userId(principal); return withOrganizationContext(database, principal.organizationId, async (db) => { if (!(await canReadNotifications(db, principal))) throw error("FORBIDDEN", "The user cannot read notification preferences."); const [row] = await db.select().from(notificationPreferences).where(and(eq(notificationPreferences.organizationId, principal.organizationId), eq(notificationPreferences.userId, ownerUserId))).limit(1); return toPreferences(row); }); }

export async function updateNotificationPreferences(principal: AosPrincipal, input: NotificationPreferences): Promise<NotificationPreferences> { if (!database) throw error("PERSISTENCE_UNAVAILABLE", "Database access is not configured."); if (unsupportedNotificationDeliveryRequested(input)) throw error("NOTIFICATION_CHANNEL_UNAVAILABLE", "Email, push, and digest delivery are not configured for this environment."); const ownerUserId = userId(principal); return withOrganizationContext(database, principal.organizationId, async (db) => { if (!(await hasPermission(db, principal, Permission.SettingsManage))) throw error("FORBIDDEN", "The user cannot update notification preferences."); const [row] = await db.insert(notificationPreferences).values({ organizationId: principal.organizationId, userId: ownerUserId, emailEnabled: false, pushEnabled: false, workflowUpdates: input.workflowUpdates, evidenceReady: input.evidenceReady, weeklyDigest: false, updatedAt: new Date() }).onConflictDoUpdate({ target: [notificationPreferences.organizationId, notificationPreferences.userId], set: { emailEnabled: false, pushEnabled: false, workflowUpdates: input.workflowUpdates, evidenceReady: input.evidenceReady, weeklyDigest: false, updatedAt: new Date() } }).returning(); if (!row) throw error("PREFERENCES_UPDATE_FAILED", "Notification preferences could not be saved."); return toPreferences(row); }); }

export async function listNotifications(principal: AosPrincipal): Promise<readonly NotificationProjection[]> { if (!database) throw error("PERSISTENCE_UNAVAILABLE", "Database access is not configured."); const ownerUserId = userId(principal); return withOrganizationContext(database, principal.organizationId, async (db) => { if (!(await canReadNotifications(db, principal))) throw error("FORBIDDEN", "The user cannot read notifications."); const [preferenceRow] = await db.select().from(notificationPreferences).where(and(eq(notificationPreferences.organizationId, principal.organizationId), eq(notificationPreferences.userId, ownerUserId))).limit(1); const preferences = toPreferences(preferenceRow); await syncOperationalNotifications(db, principal, ownerUserId, preferences); const rows = await db.select().from(notifications).where(and(eq(notifications.organizationId, principal.organizationId), eq(notifications.userId, ownerUserId))).orderBy(desc(notifications.createdAt)).limit(100); return rows.map(toNotification); }); }

export async function markNotificationRead(principal: AosPrincipal, notificationId: string): Promise<boolean> { if (!database) throw error("PERSISTENCE_UNAVAILABLE", "Database access is not configured."); const ownerUserId = userId(principal); return withOrganizationContext(database, principal.organizationId, async (db) => { if (!(await canReadNotifications(db, principal))) throw error("FORBIDDEN", "The user cannot update notifications."); const rows = await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, notificationId), eq(notifications.organizationId, principal.organizationId), eq(notifications.userId, ownerUserId))).returning({ id: notifications.id }); return rows.length > 0; }); }
