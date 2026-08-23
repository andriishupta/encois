import { and, eq } from "drizzle-orm";
import {
  IntegrationStatus,
  KnowledgeSourceStatus,
  Permission,
  RecommendationStatus,
  RecommendationTarget,
  WorkflowExecutionStatus,
  type ExecutionScope,
  type JsonObject,
  type RecommendationProjection,
} from "@encois/contracts";
import { auditEvents, coordinatorRecommendations, withOrganizationContext } from "@encois/persistence";
import { hasPermission } from "../auth/authorization.js";
import { database } from "../database.js";
import type { AosPrincipal } from "../middleware/aos.js";
import { listIntegrationsForPrincipal } from "../integrations/services/integrations.service.js";
import { listKnowledgeSources } from "../sources/services/source.service.js";
import { listWorkflows, type WorkflowServiceOptions } from "../workflows/services/workflow.service.js";

export type RecommendationServiceError = Error & { code: string };

function error(code: string, message: string): RecommendationServiceError {
  const value = new Error(message) as RecommendationServiceError;
  value.code = code;
  return value;
}

export function isRecommendationServiceError(value: unknown): value is RecommendationServiceError {
  return value instanceof Error && typeof (value as Partial<RecommendationServiceError>).code === "string";
}

function localUserId(principal: AosPrincipal): string {
  const candidate = principal.userId ?? principal.actorId;
  if (!/^[0-9a-f-]{36}$/i.test(candidate)) throw error("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");
  return candidate;
}

function scope(principal: AosPrincipal): ExecutionScope {
  return { ids: [...new Set(principal.scope.filter((value) => value.trim().length > 0))] };
}

function toRecommendation(row: typeof coordinatorRecommendations.$inferSelect): RecommendationProjection {
  return {
    id: row.id,
    organizationId: row.organizationId,
    recommendationKey: row.recommendationKey,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    description: row.description,
    target: row.target as RecommendationProjection["target"],
    actionLabel: row.actionLabel,
    status: row.status,
    scope: (row.scope && typeof row.scope === "object" && !Array.isArray(row.scope) ? row.scope : { ids: [] }) as ExecutionScope,
    metadata: (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {}) as JsonObject,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    observedAt: row.observedAt.toISOString(),
    ...(row.acceptedAt ? { acceptedAt: row.acceptedAt.toISOString() } : {}),
    ...(row.dismissedAt ? { dismissedAt: row.dismissedAt.toISOString() } : {}),
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
  };
}

type RecommendationCandidate = Pick<RecommendationProjection, "recommendationKey" | "kind" | "severity" | "title" | "description" | "target" | "actionLabel" | "metadata">;

async function generateCandidates(principal: AosPrincipal, options: WorkflowServiceOptions): Promise<readonly RecommendationCandidate[]> {
  if (!database) throw error("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  const capabilities = await withOrganizationContext(database, principal.organizationId, async (db) => ({
    integrationsRead: await hasPermission(db, principal, Permission.IntegrationsRead),
    integrationsManage: await hasPermission(db, principal, Permission.IntegrationsManage),
    knowledgeRead: await hasPermission(db, principal, Permission.KnowledgeRead),
    knowledgeManage: await hasPermission(db, principal, Permission.KnowledgeManage),
    workflowsRead: await hasPermission(db, principal, Permission.WorkflowsRead),
    workflowsManage: await hasPermission(db, principal, Permission.WorkflowsManage),
  }));

  const [integrations, sources, workflows] = await Promise.all([
    capabilities.integrationsRead ? listIntegrationsForPrincipal(principal) : Promise.resolve([]),
    capabilities.knowledgeRead ? listKnowledgeSources(principal) : Promise.resolve([]),
    capabilities.workflowsRead ? listWorkflows(principal, options) : Promise.resolve([]),
  ]);
  const candidates: RecommendationCandidate[] = [];
  const activeIntegrations = integrations.filter((item) => item.status === IntegrationStatus.Active);
  const pendingIntegrations = integrations.filter((item) => !new Set<IntegrationStatus>([IntegrationStatus.Active, IntegrationStatus.Disabled]).has(item.status));
  const unhealthySources = sources.filter((source) => new Set<KnowledgeSourceStatus>([KnowledgeSourceStatus.Degraded, KnowledgeSourceStatus.NeedsReauth, KnowledgeSourceStatus.Failed]).has(source.status));
  const needsRunReview = workflows.filter((workflow) => new Set<WorkflowExecutionStatus>([WorkflowExecutionStatus.Waiting, WorkflowExecutionStatus.Failed, WorkflowExecutionStatus.Partial]).has(workflow.status));

  if (capabilities.integrationsRead && capabilities.integrationsManage && activeIntegrations.length === 0) {
    candidates.push({
      recommendationKey: "workspace.connect-provider",
      kind: "workspace_setup",
      severity: "attention",
      title: "Connect a provider",
      description: "Authorize a read-only provider before creating a workflow that needs external evidence.",
      target: RecommendationTarget.Integrations,
      actionLabel: "Open integrations",
      metadata: { activeIntegrations: 0 },
    });
  }
  if (capabilities.integrationsRead && pendingIntegrations.length > 0) {
    candidates.push({
      recommendationKey: "integration.attention",
      kind: "integration_health",
      severity: "attention",
      title: "Review provider setup",
      description: `${pendingIntegrations.length} Integration${pendingIntegrations.length === 1 ? " needs" : "s need"} authorization or recovery before it can feed a Source.`,
      target: RecommendationTarget.Integrations,
      actionLabel: "Review integrations",
      metadata: { pendingIntegrations: pendingIntegrations.length },
    });
  }
  if (capabilities.knowledgeRead && capabilities.knowledgeManage && sources.length === 0) {
    candidates.push({
      recommendationKey: "workspace.add-source",
      kind: "workspace_setup",
      severity: "attention",
      title: "Add a Knowledge Source",
      description: "Upload context or bind an authorized Integration so workflow Runs can produce evidence.",
      target: RecommendationTarget.NewSource,
      actionLabel: "Add Source",
      metadata: { sources: 0 },
    });
  }
  if (capabilities.knowledgeRead && unhealthySources.length > 0) {
    candidates.push({
      recommendationKey: "source.attention",
      kind: "source_health",
      severity: "attention",
      title: "Review Source health",
      description: `${unhealthySources.length} Knowledge Source${unhealthySources.length === 1 ? " needs" : "s need"} attention before its evidence should be trusted.`,
      target: RecommendationTarget.Sources,
      actionLabel: "Review Sources",
      metadata: { unhealthySources: unhealthySources.length },
    });
  }
  if (capabilities.workflowsRead && capabilities.workflowsManage && workflows.length === 0) {
    candidates.push({
      recommendationKey: "workspace.create-workflow",
      kind: "workspace_setup",
      severity: "info",
      title: "Create the first workflow",
      description: "Choose a published Template, an approved Blueprint, or describe a GitHub/Jira investigation.",
      target: RecommendationTarget.NewWorkflow,
      actionLabel: "Create workflow",
      metadata: { workflows: 0 },
    });
  }
  if (capabilities.workflowsRead && needsRunReview.length > 0) {
    candidates.push({
      recommendationKey: "workflow.attention",
      kind: "run_review",
      severity: "attention",
      title: "Review workflow attention",
      description: `${needsRunReview.length} Run${needsRunReview.length === 1 ? " needs" : "s need"} an explicit human decision before it can progress or be trusted.`,
      target: RecommendationTarget.Review,
      actionLabel: "Review Runs",
      metadata: { runs: needsRunReview.length },
    });
  }
  if (capabilities.knowledgeRead && capabilities.workflowsRead && sources.length > 0 && workflows.length > 0) {
    candidates.push({
      recommendationKey: "context.review-readiness",
      kind: "context_readiness",
      severity: "info",
      title: "Check project context",
      description: "Inspect the scoped graph and Source freshness before trusting a new investigation.",
      target: RecommendationTarget.Context,
      actionLabel: "Open context",
      metadata: { sources: sources.length, workflows: workflows.length },
    });
  }
  return candidates;
}

export async function listRecommendations(principal: AosPrincipal, options: WorkflowServiceOptions): Promise<readonly RecommendationProjection[]> {
  if (!database) throw error("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  const userId = localUserId(principal);
  const candidates = await generateCandidates(principal, options);
  const currentScope = scope(principal);
  const now = new Date();

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const existing = await db.select().from(coordinatorRecommendations).where(and(eq(coordinatorRecommendations.organizationId, principal.organizationId), eq(coordinatorRecommendations.userId, userId)));
    const candidateKeys = new Set(candidates.map((candidate) => candidate.recommendationKey));
    for (const candidate of candidates) {
      const row = existing.find((item) => item.recommendationKey === candidate.recommendationKey);
      if (!row) {
        await db.insert(coordinatorRecommendations).values({ organizationId: principal.organizationId, userId, ...candidate, scope: currentScope, observedAt: now, createdAt: now, updatedAt: now });
        continue;
      }
      await db.update(coordinatorRecommendations).set({ ...candidate, scope: currentScope, observedAt: now, updatedAt: now, ...(row.status === RecommendationStatus.Resolved ? { status: RecommendationStatus.Open, resolvedAt: null, acceptedAt: null, dismissedAt: null } : {}) }).where(and(eq(coordinatorRecommendations.id, row.id), eq(coordinatorRecommendations.organizationId, principal.organizationId), eq(coordinatorRecommendations.userId, userId)));
    }
    for (const row of existing) {
      if (candidateKeys.has(row.recommendationKey) || row.status === RecommendationStatus.Resolved) continue;
      await db.update(coordinatorRecommendations).set({ status: RecommendationStatus.Resolved, resolvedAt: now, updatedAt: now }).where(and(eq(coordinatorRecommendations.id, row.id), eq(coordinatorRecommendations.organizationId, principal.organizationId), eq(coordinatorRecommendations.userId, userId)));
    }
    const rows = await db.select().from(coordinatorRecommendations).where(and(eq(coordinatorRecommendations.organizationId, principal.organizationId), eq(coordinatorRecommendations.userId, userId)));
    return rows.filter((row) => candidateKeys.has(row.recommendationKey)).map(toRecommendation).sort((left, right) => Number(right.severity === "attention") - Number(left.severity === "attention") || right.updatedAt.localeCompare(left.updatedAt));
  });
}

export async function updateRecommendation(principal: AosPrincipal, recommendationId: string, action: "accept" | "dismiss"): Promise<RecommendationProjection | null> {
  if (!database) throw error("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  const userId = localUserId(principal);
  if (!/^[0-9a-f-]{36}$/i.test(recommendationId)) return null;
  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const [row] = await db.select().from(coordinatorRecommendations).where(and(eq(coordinatorRecommendations.id, recommendationId), eq(coordinatorRecommendations.organizationId, principal.organizationId), eq(coordinatorRecommendations.userId, userId))).limit(1);
    if (!row || row.status === RecommendationStatus.Resolved) return null;
    const now = new Date();
    const status = action === "accept" ? RecommendationStatus.Accepted : RecommendationStatus.Dismissed;
    const [updated] = await db.update(coordinatorRecommendations).set({ status, acceptedAt: action === "accept" ? now : null, dismissedAt: action === "dismiss" ? now : null, updatedAt: now }).where(and(eq(coordinatorRecommendations.id, recommendationId), eq(coordinatorRecommendations.organizationId, principal.organizationId), eq(coordinatorRecommendations.userId, userId))).returning();
    if (!updated) return null;
    await db.insert(auditEvents).values({ organizationId: principal.organizationId, actorUserId: userId, action: `recommendation_${action}`, outcome: action === "accept" ? "accepted" : "dismissed", resourceType: "coordinator_recommendation", resourceId: recommendationId, scope: row.scope, metadata: { recommendationKey: row.recommendationKey, target: row.target } });
    return toRecommendation(updated);
  });
}
