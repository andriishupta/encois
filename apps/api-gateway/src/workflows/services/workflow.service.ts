import { and, eq, isNull, or } from "drizzle-orm";
import {
  organizationMemberships,
  rolePermissions,
  workflowDefinitions,
  workflowRuns,
  type PersistenceDatabase,
  withOrganizationContext,
} from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { buildWorkflowId, type WorkflowExecutionProjection, type WorkflowStartRequest } from "../types.js";
import type { WorkflowClient } from "../temporal-client.js";

export class WorkflowServiceError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
  }
}

function localUserId(principal: AosPrincipal): string | null {
  const candidate = principal.userId ?? principal.actorId;
  return /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null;
}

export class WorkflowService {
  public constructor(
    private readonly workflowClient: WorkflowClient,
    private readonly namespace: string,
    private readonly taskQueue: string,
    private readonly database?: PersistenceDatabase,
  ) {}

  async start(
    principal: AosPrincipal,
    request: WorkflowStartRequest,
    requestId: string,
  ): Promise<WorkflowExecutionProjection> {
    const workflowId = buildWorkflowId({
      organizationId: principal.organizationId,
      workflowType: request.workflowType,
      key: request.key ?? requestId,
    });

    if (!this.database) {
      return this.workflowClient.start(
        {
          workflowType: request.workflowType,
          workflowId,
          taskQueue: this.taskQueue,
          input: {
          actorId: principal.actorId,
          organizationId: principal.organizationId,
          requestId,
          workflowId,
          scope: principal.scope,
            userId: principal.userId,
            payload: request.input ?? {},
            workflowScope: request.scope ?? {},
          },
        },
        this.namespace,
      );
    }

    const userId = localUserId(principal);
    if (!userId) throw new WorkflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");

    return withOrganizationContext(this.database, principal.organizationId, async (db) => {
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
      if (!permission) throw new WorkflowServiceError("FORBIDDEN", "The user cannot start workflows.");

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
        throw new WorkflowServiceError(
          "WORKFLOW_DEFINITION_NOT_FOUND",
          `No approved workflow definition exists for ${request.workflowType}@${version}.`,
        );
      }

      const projection = await this.workflowClient.start(
        {
          workflowType: request.workflowType,
          workflowId,
          taskQueue: this.taskQueue,
          input: {
            actorId: principal.actorId,
            organizationId: principal.organizationId,
            requestId,
            workflowId,
            scope: principal.scope,
            userId,
            payload: request.input ?? {},
            workflowScope: request.scope ?? {},
          },
        },
        this.namespace,
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

  async get(principal: AosPrincipal, workflowId: string): Promise<WorkflowExecutionProjection | null> {
    if (!this.database) return this.workflowClient.get(workflowId, principal.organizationId, this.namespace);

    const userId = localUserId(principal);
    if (!userId) throw new WorkflowServiceError("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");

    const authorized = await withOrganizationContext(this.database, principal.organizationId, async (db) => {
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
    return this.workflowClient.get(workflowId, principal.organizationId, this.namespace);
  }
}
