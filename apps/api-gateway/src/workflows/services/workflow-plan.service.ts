import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { CoordinatorEvent, WorkflowChangePlanV2 } from "@encois/contracts";
import {
	auditEvents,
	coordinatorEventOutbox,
	type PersistenceTransaction,
  workflowChangePlans,
  workflowBlueprints,
  workflowDefinitions,
  type WorkflowPlanStatus,
  withOrganizationContext,
} from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { database } from "../../database.js";
import type { WorkflowClient } from "../temporal-client.js";
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
	eventType: "workflow-plan-approved" | "workflow-plan-applied",
): CoordinatorEvent {
	const workflowStarts =
		eventType === "workflow-plan-applied"
			? plan.plan.changes.flatMap((change) => {
					if (!change.start || !change.blueprint) return [];
					return [{
						blueprintId: change.blueprint.blueprintId,
						blueprintVersion: change.blueprint.version,
						key: change.start.key,
						...(change.start.businessInput ? { businessInput: change.start.businessInput } : {}),
					}];
				})
			: [];
	return {
		contractVersion: "coordinator-event.v1",
		eventId: `${eventType}:${plan.planId}`,
		eventType,
		coordinatorId: plan.coordinatorId,
		organizationId: plan.organizationId,
		actorId: principal.actorId,
		planId: plan.planId,
		...(eventType === "workflow-plan-approved" ? { approved: true } : {}),
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
    return recordFromRow(created);
  });
}

async function requirePlanManager(principal: AosPrincipal): Promise<string> {
  if (!database) return persistenceUnavailable();
  const userId = localUserId(principal);
  if (!userId) throw workflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");
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
 * v1 applies create changes. v2 additionally applies Blueprint revisions,
 * deprecations, and cancel-only Temporal execution plans.
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

  const v2Plan = plan.contractVersion === "workflow-change-plan.v2" ? plan : undefined;
  const isV2 = Boolean(v2Plan);
  const cancelChanges = v2Plan ? v2Plan.changes.filter((change) => change.kind === "cancel") : [];
  const unsupportedChange = plan.changes.find((change) => {
    if (!isV2) return change.kind !== "create";
    return cancelChanges.length > 0 ? change.kind !== "cancel" : false;
  });
  if (unsupportedChange) {
    throw workflowServiceError(
      "WORKFLOW_PLAN_APPLICATION_UNSUPPORTED",
      isV2
        ? "A workflow-change-plan.v2 cancel plan may contain only Temporal cancellation changes."
        : `The v1 application slice supports create changes only; ${unsupportedChange.kind} requires workflow-change-plan.v2.`,
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
    // v1 changes are safe to treat as the v2 shape here because all v1
    // non-create changes are rejected above and create has no target fields.
    const changes = (v2Plan ? v2Plan.changes : plan.changes) as WorkflowChangePlanV2["changes"];
    for (const change of cancelChanges.length > 0 ? [] : changes) {
      if (isV2 && change.kind === "deprecate") {
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
        await db
          .update(workflowBlueprints)
          .set({ status: "retired", updatedAt: now })
          .where(eq(workflowBlueprints.id, target.id));
        actions.push(`deprecate:${change.targetBlueprintId}@${change.targetBlueprintVersion}`);
        continue;
      }

      const blueprint = change.blueprint;
      if (!blueprint) {
        throw workflowServiceError("WORKFLOW_PLAN_INVALID", `${change.kind} change is missing a Blueprint.`);
      }

      if (isV2 && change.kind === "update") {
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
