import { and, desc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { ContractVersion, CoordinatorEventType, Permission, type CoordinatorEvent, type WorkflowPlannerVersionProjection } from "@encois/contracts";
import {
	auditEvents,
	coordinatorEventOutbox,
	type PersistenceTransaction,
  workflowChangePlans,
  workflowPlannerVersions,
  workflowBlueprints,
  workflowDefinitions,
  type WorkflowPlanStatus,
  withOrganizationContext,
} from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { database } from "../../database.js";
import { hasPermission } from "../../auth/authorization.js";
import type { WorkflowClient } from "../temporal-client.js";
import { listPage, type ListPage, type ListQuery } from "../list-query.js";
import {
  isWorkflowServiceError,
  localUserId,
  stableSerialize,
  validateWorkflowChangePlan,
  type WorkflowChangePlanInput,
  workflowServiceError,
} from "./workflow.service.js";

export type WorkflowPlanRecord = {
  planId: string;
  organizationId: string;
  coordinatorId: string;
  projectId?: string;
  status: WorkflowPlanStatus;
  approvalRequired: boolean;
  plan: WorkflowChangePlanInput;
  submittedByUserId?: string;
  approvedByUserId?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  appliedAt?: string;
};

export type WorkflowPlanApplicationOptions = {
  workflowClient: WorkflowClient;
  namespace: string;
};

function planHash(plan: WorkflowChangePlanInput): string {
  return createHash("sha256").update(stableSerialize(plan)).digest("hex");
}

function dateString(value: Date | null | undefined): string | undefined {
  return value?.toISOString();
}

function planMetadata(plan: WorkflowChangePlanInput): {
  plannerName?: string;
  plannerVersion?: string;
  sourceSchemaVersion?: string;
  promptVersion?: string;
  promptHash?: string;
} {
  const metadata = plan.metadata;
  return {
    ...(metadata?.planner?.name ? { plannerName: metadata.planner.name } : {}),
    ...(metadata?.planner?.version ? { plannerVersion: metadata.planner.version } : {}),
    ...(metadata?.sourceSchemaVersion ? { sourceSchemaVersion: metadata.sourceSchemaVersion } : {}),
    ...(metadata?.promptVersion ? { promptVersion: metadata.promptVersion } : {}),
    ...(metadata?.promptHash ? { promptHash: metadata.promptHash } : {}),
  };
}

function plannerVersionHash(metadata: ReturnType<typeof planMetadata>): string {
  return createHash("sha256").update(stableSerialize(metadata)).digest("hex");
}

async function recordPlannerVersion(
  db: PersistenceTransaction,
  organizationId: string,
  planId: string,
  plan: WorkflowChangePlanInput,
  observedAt: Date,
): Promise<void> {
  const metadata = planMetadata(plan);
  const versionHash = plannerVersionHash(metadata);
  await db
    .insert(workflowPlannerVersions)
    .values({
      organizationId,
      ...metadata,
      versionHash,
      firstPlanId: planId,
      lastPlanId: planId,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
    })
    .onConflictDoUpdate({
      target: [workflowPlannerVersions.organizationId, workflowPlannerVersions.versionHash],
      set: {
        lastPlanId: planId,
        lastSeenAt: observedAt,
        usageCount: sql<number>`${workflowPlannerVersions.usageCount} + 1`,
      },
    });
}

function plannerVersionFromRow(row: typeof workflowPlannerVersions.$inferSelect): WorkflowPlannerVersionProjection {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ...(row.plannerName ? { plannerName: row.plannerName } : {}),
    ...(row.plannerVersion ? { plannerVersion: row.plannerVersion } : {}),
    ...(row.sourceSchemaVersion ? { sourceSchemaVersion: row.sourceSchemaVersion } : {}),
    ...(row.promptVersion ? { promptVersion: row.promptVersion } : {}),
    ...(row.promptHash ? { promptHash: row.promptHash } : {}),
    versionHash: row.versionHash,
    firstPlanId: row.firstPlanId,
    lastPlanId: row.lastPlanId,
    usageCount: row.usageCount,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

function recordFromRow(row: typeof workflowChangePlans.$inferSelect): WorkflowPlanRecord {
  return {
    planId: row.planId,
    organizationId: row.organizationId,
    coordinatorId: row.coordinatorId,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    status: row.status,
    approvalRequired: row.approvalRequired,
    plan: row.plan as unknown as WorkflowChangePlanInput,
    ...(row.submittedByUserId ? { submittedByUserId: row.submittedByUserId } : {}),
    ...(row.approvedByUserId ? { approvedByUserId: row.approvedByUserId } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(dateString(row.approvedAt) ? { approvedAt: dateString(row.approvedAt) } : {}),
    ...(dateString(row.appliedAt) ? { appliedAt: dateString(row.appliedAt) } : {}),
  };
}

function persistenceUnavailable(): never {
	throw workflowServiceError("PERSISTENCE_UNAVAILABLE", "Workflow plan persistence is not configured.");
}

export function createPlanCoordinatorEvent(
	principal: AosPrincipal,
	plan: Pick<WorkflowPlanRecord, "planId" | "coordinatorId" | "organizationId" | "plan">,
	eventType: typeof CoordinatorEventType.WorkflowPlanApproved | typeof CoordinatorEventType.WorkflowPlanApplied,
): CoordinatorEvent {
	const workflowStarts =
		eventType === CoordinatorEventType.WorkflowPlanApplied
			? plan.plan.changes.flatMap((change) => {
					if (!change.start || !change.blueprint) return [];
					return [{
						blueprintId: change.blueprint.blueprintId,
						blueprintVersion: change.blueprint.version,
						key: change.start.key,
						...(change.start.businessInput ? { businessInput: change.start.businessInput } : {}),
						scope: { ids: [...principal.scope] },
					}];
				})
			: [];
	return {
		contractVersion: ContractVersion.CoordinatorEvent,
		eventId: `${eventType}:${plan.planId}`,
		eventType,
		coordinatorId: plan.coordinatorId,
		organizationId: plan.organizationId,
		actorId: principal.actorId,
		planId: plan.planId,
		...(eventType === CoordinatorEventType.WorkflowPlanApproved ? { approved: true } : {}),
		...(principal.scope.length > 0 ? { scope: { ids: [...principal.scope] } } : {}),
		...(workflowStarts.length > 0 ? { workflowStarts } : {}),
	};
}

async function enqueueCoordinatorEvent(db: PersistenceTransaction, event: CoordinatorEvent): Promise<void> {
	await db
		.insert(coordinatorEventOutbox)
		.values({
			organizationId: event.organizationId,
			eventId: event.eventId,
			coordinatorId: event.coordinatorId,
			eventType: event.eventType,
			payload: event as unknown as Record<string, unknown>,
		})
		.onConflictDoNothing();
}

export async function submitWorkflowPlan(
  principal: AosPrincipal,
  plan: WorkflowChangePlanInput,
): Promise<WorkflowPlanRecord> {
  if (!database) return persistenceUnavailable();

  const validation = await validateWorkflowChangePlan(principal, plan);
  const userId = localUserId(principal);
  if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");
  const hash = planHash(plan);

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const [existing] = await db
      .select()
      .from(workflowChangePlans)
      .where(
        and(
          eq(workflowChangePlans.organizationId, principal.organizationId),
          eq(workflowChangePlans.planId, plan.planId),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.planHash !== hash) {
        throw workflowServiceError("IDEMPOTENCY_CONFLICT", "The plan ID already belongs to a different proposal.");
      }
      return recordFromRow(existing);
    }

    const [created] = await db
      .insert(workflowChangePlans)
      .values({
        organizationId: principal.organizationId,
        planId: plan.planId,
        coordinatorId: plan.coordinatorId,
        projectId: plan.projectId,
        planHash: hash,
        plan: plan as unknown as Record<string, unknown>,
        ...planMetadata(plan),
        status: "proposed",
        approvalRequired: validation.approvalRequired,
        submittedByUserId: userId,
      })
      .returning();
    if (!created) throw workflowServiceError("PLAN_PERSISTENCE_FAILED", "The workflow plan could not be persisted.");

    await db.insert(auditEvents).values({
      organizationId: principal.organizationId,
      actorUserId: userId,
      action: "workflow_plan_submitted",
      outcome: "accepted",
      resourceType: "workflow_change_plan",
      resourceId: plan.planId,
      scope: { ids: principal.scope },
      metadata: { changeCount: plan.changes.length, approvalRequired: validation.approvalRequired },
    });
    await recordPlannerVersion(db, principal.organizationId, plan.planId, plan, new Date());
    return recordFromRow(created);
  });
}

async function requirePlanManager(principal: AosPrincipal): Promise<string> {
  if (!database) return persistenceUnavailable();
  const userId = localUserId(principal);
  if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");
  const canManage = await withOrganizationContext(database, principal.organizationId, (db) => hasPermission(db, principal, Permission.WorkflowsManage));
  if (!canManage) throw workflowServiceError("FORBIDDEN", "The user cannot manage workflow change plans.");
  return userId;
}

export async function getWorkflowPlan(principal: AosPrincipal, planId: string): Promise<WorkflowPlanRecord | null> {
  if (!database) return persistenceUnavailable();
  const row = await withOrganizationContext(database, principal.organizationId, async (db) => {
    const [row] = await db
      .select()
      .from(workflowChangePlans)
      .where(
        and(
          eq(workflowChangePlans.organizationId, principal.organizationId),
          eq(workflowChangePlans.planId, planId),
        ),
      )
      .limit(1);
    return row ?? null;
  });
  if (!row) return null;
  await validateWorkflowChangePlan(principal, row.plan as unknown as WorkflowChangePlanInput);
  return recordFromRow(row);
}

function planScopeVisible(plan: WorkflowChangePlanInput, principal: AosPrincipal): boolean {
  if (principal.scope.includes("*")) return true;
  if (!plan.scope?.ids?.length) return false;
  return plan.scope.ids.every((scope) => principal.scope.includes(scope));
}

export async function listWorkflowPlans(
  principal: AosPrincipal,
  limit = 100,
): Promise<readonly WorkflowPlanRecord[]> {
  return (await listWorkflowPlansPage(principal, {
    sort: "updated-desc",
    limit: Math.max(1, Math.min(limit, 100)),
    offset: 0,
  })).items;
}

export async function listWorkflowPlansPage(
  principal: AosPrincipal,
  query: ListQuery,
): Promise<ListPage<WorkflowPlanRecord>> {
  if (!database) return persistenceUnavailable();
  await requirePlanManager(principal);
  const rows = await withOrganizationContext(database, principal.organizationId, (db) => db
    .select()
    .from(workflowChangePlans)
    .where(eq(workflowChangePlans.organizationId, principal.organizationId))
    .orderBy(desc(workflowChangePlans.updatedAt))
    .limit(100));

  const visible: WorkflowPlanRecord[] = [];
  for (const row of rows) {
    const plan = row.plan as unknown as WorkflowChangePlanInput;
    if (!planScopeVisible(plan, principal)) continue;
    try {
      await validateWorkflowChangePlan(principal, plan);
      visible.push(recordFromRow(row));
    } catch {
      // A plan that no longer validates against the caller's current scope is
      // intentionally omitted instead of leaking a stale or unauthorized proposal.
    }
  }
  const normalizedQuery = query.query?.toLowerCase();
  const filtered = visible.filter((plan) => {
    if (query.status && plan.status !== query.status) return false;
    if (!normalizedQuery) return true;
    const change = plan.plan.changes[0];
    const searchable = [change?.blueprint?.name, change?.blueprint?.purpose, change?.reason, plan.planId]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase();
    return searchable.includes(normalizedQuery);
  });
  const sorted = [...filtered].sort((left, right) => {
    if (query.sort === "updated-asc") return left.updatedAt.localeCompare(right.updatedAt);
    if (query.sort === "name-asc") return (left.plan.changes[0]?.blueprint?.name ?? "").localeCompare(right.plan.changes[0]?.blueprint?.name ?? "");
    if (query.sort === "status") return left.status.localeCompare(right.status) || right.updatedAt.localeCompare(left.updatedAt);
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  return listPage(sorted, query);
}

export async function listWorkflowPlannerVersions(
  principal: AosPrincipal,
  limit = 100,
): Promise<readonly WorkflowPlannerVersionProjection[]> {
  if (!database) return persistenceUnavailable();
  await requirePlanManager(principal);
  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const rows = await db
      .select()
      .from(workflowPlannerVersions)
      .where(eq(workflowPlannerVersions.organizationId, principal.organizationId))
      .orderBy(desc(workflowPlannerVersions.lastSeenAt))
      .limit(Math.max(1, Math.min(limit, 100)));
    return rows.map(plannerVersionFromRow);
  });
}

export async function approveWorkflowPlan(principal: AosPrincipal, planId: string): Promise<WorkflowPlanRecord> {
  if (!database) return persistenceUnavailable();
  const userId = await requirePlanManager(principal);

  const row = await withOrganizationContext(database, principal.organizationId, async (db) => {
    const [row] = await db
      .select()
      .from(workflowChangePlans)
      .where(and(eq(workflowChangePlans.organizationId, principal.organizationId), eq(workflowChangePlans.planId, planId)))
      .limit(1);
    return row ?? null;
  });
  if (!row) throw workflowServiceError("WORKFLOW_PLAN_NOT_FOUND", "Workflow change plan not found.");

  const plan = row.plan as unknown as WorkflowChangePlanInput;
  const validation = await validateWorkflowChangePlan(principal, plan);
  if (row.status === "approved") return recordFromRow(row);
  if (row.status !== "proposed") {
    throw workflowServiceError("WORKFLOW_PLAN_NOT_APPROVABLE", `Workflow change plan is ${row.status}.`);
  }

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const now = new Date();
    const [updated] = await db
      .update(workflowChangePlans)
      .set({
        status: "approved",
        approvalRequired: validation.approvalRequired,
        approvedByUserId: userId,
        approvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowChangePlans.organizationId, principal.organizationId),
          eq(workflowChangePlans.planId, planId),
          eq(workflowChangePlans.status, "proposed"),
        ),
      )
      .returning();
    if (!updated) throw workflowServiceError("WORKFLOW_PLAN_APPROVAL_CONFLICT", "The workflow plan changed concurrently.");

    await db.insert(auditEvents).values({
      organizationId: principal.organizationId,
      actorUserId: userId,
      action: "workflow_plan_approved",
      outcome: "accepted",
      resourceType: "workflow_change_plan",
      resourceId: planId,
      scope: { ids: principal.scope },
      metadata: { approvalRequired: validation.approvalRequired, applyStatus: "not_applied" },
    });
    const record = recordFromRow(updated);
    await enqueueCoordinatorEvent(db, createPlanCoordinatorEvent(principal, record, "workflow-plan-approved"));
    return record;
  });
}

/**
 * Apply an approved plan to the control-plane Blueprint registry.
 *
 * v1 contains create, Blueprint lifecycle, and cancel changes. Cancellation
 * remains a cancel-only application so a Temporal side effect is never mixed
 * with registry mutation in one request.
 */
export async function applyWorkflowPlan(
	principal: AosPrincipal,
	planId: string,
	options: WorkflowPlanApplicationOptions,
): Promise<WorkflowPlanRecord> {
  if (!database) return persistenceUnavailable();
  const userId = await requirePlanManager(principal);

  const row = await withOrganizationContext(database, principal.organizationId, async (db) => {
    const [row] = await db
      .select()
      .from(workflowChangePlans)
      .where(and(eq(workflowChangePlans.organizationId, principal.organizationId), eq(workflowChangePlans.planId, planId)))
      .limit(1);
    return row ?? null;
  });
  if (!row) throw workflowServiceError("WORKFLOW_PLAN_NOT_FOUND", "Workflow change plan not found.");

  const plan = row.plan as unknown as WorkflowChangePlanInput;
  const validation = await validateWorkflowChangePlan(principal, plan);
  if (row.status === "applied") return recordFromRow(row);
  if (row.status !== "approved") {
    throw workflowServiceError("WORKFLOW_PLAN_NOT_APPLICABLE", `Workflow change plan is ${row.status}.`);
  }

  const cancelChanges = plan.changes.filter((change) => change.kind === "cancel");
  const unsupportedChange = plan.changes.find((change) => {
    return cancelChanges.length > 0 ? change.kind !== "cancel" : false;
  });
  if (unsupportedChange) {
    throw workflowServiceError(
      "WORKFLOW_PLAN_APPLICATION_UNSUPPORTED",
      "A workflow-change-plan.v1 cancel plan may contain only Temporal cancellation changes.",
    );
  }

  if (cancelChanges.length > 0) {
    for (const change of cancelChanges) {
      if (!change.targetWorkflowId) {
        throw workflowServiceError("WORKFLOW_PLAN_INVALID", "Cancel change is missing its Temporal workflow target.");
      }
      try {
        await options.workflowClient.cancel(change.targetWorkflowId, principal.organizationId, options.namespace);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Temporal workflow cancellation failed.";
        throw workflowServiceError("WORKFLOW_CANCELLATION_FAILED", message);
      }
    }
  }

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const now = new Date();
    const actions: string[] = [];
    for (const change of cancelChanges.length > 0 ? [] : plan.changes) {
      if (change.kind === "deprecate") {
        if (!change.targetBlueprintId || !change.targetBlueprintVersion) {
          throw workflowServiceError("WORKFLOW_PLAN_INVALID", "Deprecate change is missing its Blueprint target.");
        }
        const [target] = await db
          .select()
          .from(workflowBlueprints)
          .where(
            and(
              eq(workflowBlueprints.organizationId, principal.organizationId),
              eq(workflowBlueprints.blueprintId, change.targetBlueprintId),
              eq(workflowBlueprints.version, change.targetBlueprintVersion),
            ),
          )
          .limit(1);
        if (!target || target.status !== "approved") {
          throw workflowServiceError(
            "WORKFLOW_BLUEPRINT_TARGET_NOT_FOUND",
            `Approved Blueprint ${change.targetBlueprintId}@${change.targetBlueprintVersion} was not found.`,
          );
        }
        if (target.isCurrent) {
          throw workflowServiceError(
            "WORKFLOW_BLUEPRINT_CURRENT_REQUIRED",
            "Mark another approved revision current before deprecating the current Blueprint revision.",
          );
        }
        await db
          .update(workflowBlueprints)
          .set({ status: "retired", updatedAt: now })
          .where(eq(workflowBlueprints.id, target.id));
        actions.push(`deprecate:${change.targetBlueprintId}@${change.targetBlueprintVersion}`);
        continue;
      }

      if (change.kind === "restore" || change.kind === "set_current") {
        if (!change.targetBlueprintId || !change.targetBlueprintVersion) {
          throw workflowServiceError("WORKFLOW_PLAN_INVALID", `${change.kind} change is missing its Blueprint target.`);
        }
        const [target] = await db
          .select()
          .from(workflowBlueprints)
          .where(
            and(
              eq(workflowBlueprints.organizationId, principal.organizationId),
              eq(workflowBlueprints.blueprintId, change.targetBlueprintId),
              eq(workflowBlueprints.version, change.targetBlueprintVersion),
            ),
          )
          .limit(1);
        if (!target) {
          throw workflowServiceError(
            "WORKFLOW_BLUEPRINT_TARGET_NOT_FOUND",
            `Blueprint ${change.targetBlueprintId}@${change.targetBlueprintVersion} was not found.`,
          );
        }
        if (change.kind === "restore") {
          if (target.status !== "retired") {
            throw workflowServiceError("WORKFLOW_BLUEPRINT_TARGET_NOT_FOUND", "Only an archived Blueprint revision can be restored.");
          }
          await db
            .update(workflowBlueprints)
            .set({ status: "approved", isCurrent: false, approvedAt: now, updatedAt: now })
            .where(eq(workflowBlueprints.id, target.id));
        } else {
          if (target.status !== "approved") {
            throw workflowServiceError("WORKFLOW_BLUEPRINT_TARGET_NOT_FOUND", "Only an approved Blueprint revision can be marked current.");
          }
          await db
            .update(workflowBlueprints)
            .set({ isCurrent: false, updatedAt: now })
            .where(
              and(
                eq(workflowBlueprints.organizationId, principal.organizationId),
                eq(workflowBlueprints.blueprintId, target.blueprintId),
                eq(workflowBlueprints.isCurrent, true),
              ),
            );
          await db
            .update(workflowBlueprints)
            .set({ isCurrent: true, updatedAt: now })
            .where(eq(workflowBlueprints.id, target.id));
        }
        actions.push(`${change.kind}:${change.targetBlueprintId}@${change.targetBlueprintVersion}`);
        continue;
      }

      const blueprint = change.blueprint;
      if (!blueprint) {
        throw workflowServiceError("WORKFLOW_PLAN_INVALID", `${change.kind} change is missing a Blueprint.`);
      }

      if (change.kind === "update") {
        if (!change.targetBlueprintId || !change.targetBlueprintVersion) {
          throw workflowServiceError("WORKFLOW_PLAN_INVALID", "Update change is missing its Blueprint target.");
        }
        const [target] = await db
          .select()
          .from(workflowBlueprints)
          .where(
            and(
              eq(workflowBlueprints.organizationId, principal.organizationId),
              eq(workflowBlueprints.blueprintId, change.targetBlueprintId),
              eq(workflowBlueprints.version, change.targetBlueprintVersion),
            ),
          )
          .limit(1);
        if (!target || target.status !== "approved") {
          throw workflowServiceError(
            "WORKFLOW_BLUEPRINT_TARGET_NOT_FOUND",
            `Approved Blueprint ${change.targetBlueprintId}@${change.targetBlueprintVersion} was not found.`,
          );
        }
        if (blueprint.blueprintId !== target.blueprintId || blueprint.version === target.version) {
          throw workflowServiceError("WORKFLOW_PLAN_INVALID", "Update must publish a new version of its target Blueprint.");
        }
      }

      // The executable code is the pre-registered generic Workflow. The
      // definition row records that this tenant may use it; the company-
      // specific behavior is stored separately as the Blueprint snapshot.
      await db
        .insert(workflowDefinitions)
        .values({
          organizationId: principal.organizationId,
          key: blueprint.workflowType,
          version: "v1",
          status: "approved",
          inputSchemaRef: blueprint.inputSchemaRef,
          outputSchemaRef: blueprint.outputSchemaRef,
        })
        .onConflictDoNothing();

      const [existing] = await db
        .select()
        .from(workflowBlueprints)
        .where(
          and(
            eq(workflowBlueprints.organizationId, principal.organizationId),
            eq(workflowBlueprints.blueprintId, blueprint.blueprintId),
            eq(workflowBlueprints.version, blueprint.version),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.sourcePlanId !== planId || existing.status !== "approved") {
          throw workflowServiceError(
            "WORKFLOW_BLUEPRINT_CONFLICT",
            `Blueprint ${blueprint.blueprintId}@${blueprint.version} already exists with a different source.`,
          );
        }
        actions.push(`${change.kind}:${blueprint.blueprintId}@${blueprint.version}`);
        continue;
      }

      await db.insert(workflowBlueprints).values({
        organizationId: principal.organizationId,
        blueprintId: blueprint.blueprintId,
        version: blueprint.version,
        workflowType: blueprint.workflowType,
        name: blueprint.name,
        blueprint: blueprint as unknown as Record<string, unknown>,
        status: "approved",
        isCurrent: change.kind === "create",
        sourcePlanId: planId,
        approvedAt: now,
      });
      actions.push(`${change.kind}:${blueprint.blueprintId}@${blueprint.version}`);
    }
    for (const change of cancelChanges) {
      actions.push(`cancel:${change.targetWorkflowId}`);
    }

    const [updated] = await db
      .update(workflowChangePlans)
      .set({ status: "applied", updatedAt: now, appliedAt: now })
      .where(
        and(
          eq(workflowChangePlans.organizationId, principal.organizationId),
          eq(workflowChangePlans.planId, planId),
          eq(workflowChangePlans.status, "approved"),
        ),
      )
      .returning();
    if (!updated) throw workflowServiceError("WORKFLOW_PLAN_APPLICATION_CONFLICT", "The workflow plan changed concurrently.");

    await db.insert(auditEvents).values({
      organizationId: principal.organizationId,
      actorUserId: userId,
      action: "workflow_plan_applied",
      outcome: "accepted",
      resourceType: "workflow_change_plan",
      resourceId: planId,
      scope: { ids: principal.scope },
      metadata: {
        changeCount: plan.changes.length,
        actions,
        approvalRequired: validation.approvalRequired,
      },
    });
    const record = recordFromRow(updated);
    await enqueueCoordinatorEvent(db, createPlanCoordinatorEvent(principal, record, "workflow-plan-applied"));
    return record;
  });
}

export function isWorkflowPlanServiceError(error: unknown): error is ReturnType<typeof workflowServiceError> {
  return isWorkflowServiceError(error);
}
