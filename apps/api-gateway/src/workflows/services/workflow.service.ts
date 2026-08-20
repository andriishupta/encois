import { and, eq, isNull, or } from "drizzle-orm";
import {
  organizationMemberships,
  rolePermissions,
  workflowDefinitions,
  workflowRuns,
  withOrganizationContext,
} from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { database } from "../../database.js";
import type { WorkflowClient } from "../temporal-client.js";
import {
  buildWorkflowId,
  USER_BLUEPRINT_WORKFLOW_TYPE,
  type WorkflowExecutionProjection,
  type WorkflowStartRequest,
} from "../types.js";

export type WorkflowServiceOptions = {
  workflowClient: WorkflowClient;
  namespace: string;
  taskQueue: string;
};

export type WorkflowServiceError = Error & {
  code: string;
};

export function workflowServiceError(code: string, message: string): WorkflowServiceError {
  const error = new Error(message) as WorkflowServiceError;
  error.code = code;
  return error;
}

export function isWorkflowServiceError(error: unknown): error is WorkflowServiceError {
  return error instanceof Error && typeof (error as Partial<WorkflowServiceError>).code === "string";
}

function localUserId(principal: AosPrincipal): string | null {
  const candidate = principal.userId ?? principal.actorId;
  return /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null;
}

function startCommand(
  principal: AosPrincipal,
  request: WorkflowStartRequest,
  requestId: string,
  workflowId: string,
  taskQueue: string,
) {
  const payload = request.input ?? {};
  const blueprint =
    request.workflowType === USER_BLUEPRINT_WORKFLOW_TYPE
      ? (isRecord(payload.blueprint)
          ? payload.blueprint
          : typeof payload.workflowType === "string" && Array.isArray(payload.steps)
            ? payload
            : undefined)
      : undefined;
  return {
    workflowType: request.workflowType,
    workflowId,
    taskQueue,
    input: {
      actorId: principal.actorId,
      organizationId: principal.organizationId,
      requestId,
      workflowId,
      scope: principal.scope,
      userId: principal.userId,
      blueprint,
      payload,
      workflowScope: request.scope ?? {},
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function startWorkflow(
  principal: AosPrincipal,
  request: WorkflowStartRequest,
  requestId: string,
  options: WorkflowServiceOptions,
): Promise<WorkflowExecutionProjection> {
  const workflowId = buildWorkflowId({
    organizationId: principal.organizationId,
    workflowType: request.workflowType,
    key: request.key ?? requestId,
  });

  if (!database) {
    return options.workflowClient.start(
      startCommand(principal, request, requestId, workflowId, options.taskQueue),
      options.namespace,
    );
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

    const version = request.version ?? "v1";
    const [definition] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.key, request.workflowType),
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

    const projection = await options.workflowClient.start(
      startCommand(principal, request, requestId, workflowId, options.taskQueue),
      options.namespace,
    );

    await db.insert(workflowRuns).values({
      organizationId: principal.organizationId,
      definitionId: definition.id,
      actorUserId: userId,
      temporalNamespace: projection.namespace,
      temporalTaskQueue: projection.taskQueue,
      temporalWorkflowId: projection.workflowId,
      temporalRunId: projection.runId,
      status: projection.status,
      scope: request.scope ?? {},
    });

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
  return options.workflowClient.get(workflowId, principal.organizationId, options.namespace);
}
