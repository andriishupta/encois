import { createHash } from "node:crypto";
import {
  ContractVersion,
  isJsonObject,
  parseWorkflowBlueprint,
  type WorkflowBlueprint,
  type WorkflowBlueprintLifecycleRequest,
  type WorkflowChangePlan,
} from "@encois/contracts";
import { withOrganizationContext, workflowBlueprints } from "@encois/database";
import { and, desc, eq, isNull } from "drizzle-orm";
import { database } from "../../database.js";
import type { AosPrincipal } from "../../middleware/aos.js";
import {
  submitWorkflowPlan,
  type WorkflowPlanRecord,
} from "./workflow-plan.service.js";
import {
  stableSerialize,
  workflowServiceError,
} from "./workflow-service-common.js";

function slug(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  return (normalized || fallback).slice(0, 72);
}

function parseVersion(value: string): readonly [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function nextVersion(version: string): string {
  const parsed = parseVersion(version);
  if (!parsed)
    throw workflowServiceError(
      "WORKFLOW_BLUEPRINT_VERSION_INVALID",
      "Blueprint versions must use semantic versioning, for example 1.0.1.",
    );
  return `${parsed[0]}.${parsed[1]}.${parsed[2] + 1}`;
}

function requestedVersion(value: string | undefined, current: string): string {
  const version = value?.trim() || nextVersion(current);
  const parsed = parseVersion(version);
  const currentParsed = parseVersion(current);
  if (
    !parsed ||
    !currentParsed ||
    parsed[0] < currentParsed[0] ||
    (parsed[0] === currentParsed[0] &&
      (parsed[1] < currentParsed[1] ||
        (parsed[1] === currentParsed[1] && parsed[2] <= currentParsed[2])))
  ) {
    throw workflowServiceError(
      "WORKFLOW_BLUEPRINT_VERSION_INVALID",
      "A new Blueprint version must be a greater semantic version than its source revision.",
    );
  }
  return version;
}

function lifecyclePlanId(
  principal: AosPrincipal,
  request: WorkflowBlueprintLifecycleRequest,
  blueprint: WorkflowBlueprint,
  sourceVersion: string,
): string {
  const digest = createHash("sha256")
    .update(
      stableSerialize({
        organizationId: principal.organizationId,
        request,
        blueprint,
        sourceVersion,
      }),
    )
    .digest("hex")
    .slice(0, 20);
  return `blueprint-lifecycle:${slug(blueprint.blueprintId, "blueprint")}:${digest}`;
}

function buildPlan(
  principal: AosPrincipal,
  request: WorkflowBlueprintLifecycleRequest,
  source: WorkflowBlueprint,
  sourceVersion: string,
): WorkflowChangePlan {
  const reason = request.reason.trim();
  if (reason.length < 3 || reason.length > 2000)
    throw workflowServiceError(
      "WORKFLOW_BLUEPRINT_REASON_INVALID",
      "Explain why this Blueprint lifecycle change is needed.",
    );

  if (request.action === "deprecate") {
    return {
      contractVersion: ContractVersion.WorkflowChangePlan,
      planId: lifecyclePlanId(principal, request, source, sourceVersion),
      coordinatorId: `organization:${principal.organizationId}`,
      organizationId: principal.organizationId,
      scope: { ids: [...principal.scope] },
      observedAt: new Date().toISOString(),
      metadata: {
        planner: { name: "blueprint-lifecycle", version: "1.0.0" },
        sourceSchemaVersion: ContractVersion.WorkflowBlueprint,
      },
      changes: [
        {
          kind: "deprecate",
          targetBlueprintId: source.blueprintId,
          targetBlueprintVersion: source.version,
          reason,
          requiresApproval: true,
        },
      ],
    };
  }

  if (request.action === "restore" || request.action === "mark_current") {
    return {
      contractVersion: ContractVersion.WorkflowChangePlan,
      planId: lifecyclePlanId(principal, request, source, sourceVersion),
      coordinatorId: `organization:${principal.organizationId}`,
      organizationId: principal.organizationId,
      scope: { ids: [...principal.scope] },
      observedAt: new Date().toISOString(),
      metadata: {
        planner: { name: "blueprint-lifecycle", version: "1.0.0" },
        sourceSchemaVersion: ContractVersion.WorkflowBlueprint,
      },
      changes: [
        {
          kind: request.action === "restore" ? "restore" : "set_current",
          targetBlueprintId: source.blueprintId,
          targetBlueprintVersion: source.version,
          reason,
          requiresApproval: true,
        },
      ],
    };
  }

  const version = requestedVersion(request.version, source.version);
  const duplicate = request.action === "duplicate";
  const name =
    request.name?.trim() || (duplicate ? `${source.name} copy` : source.name);
  if (name.length < 2 || name.length > 160)
    throw workflowServiceError(
      "WORKFLOW_BLUEPRINT_NAME_INVALID",
      "Blueprint name must contain between 2 and 160 characters.",
    );
  const blueprintId = duplicate
    ? `${slug(name, "blueprint")}-${createHash("sha256").update(`${source.blueprintId}:${source.version}:${name}`).digest("hex").slice(0, 8)}`
    : source.blueprintId;
  const blueprint: WorkflowBlueprint = {
    ...source,
    blueprintId,
    version,
    name,
  };
  return {
    contractVersion: ContractVersion.WorkflowChangePlan,
    planId: lifecyclePlanId(principal, request, blueprint, sourceVersion),
    coordinatorId: `organization:${principal.organizationId}`,
    organizationId: principal.organizationId,
    scope: { ids: [...principal.scope] },
    observedAt: new Date().toISOString(),
    metadata: {
      planner: { name: "blueprint-lifecycle", version: "1.0.0" },
      sourceSchemaVersion: ContractVersion.WorkflowBlueprint,
    },
    changes: [
      {
        kind: duplicate ? "create" : "update",
        ...(duplicate
          ? {}
          : {
              targetBlueprintId: source.blueprintId,
              targetBlueprintVersion: source.version,
            }),
        blueprint,
        reason,
        requiresApproval: true,
      },
    ],
  };
}

export async function createBlueprintLifecyclePlan(
  principal: AosPrincipal,
  blueprintId: string,
  request: WorkflowBlueprintLifecycleRequest,
): Promise<WorkflowPlanRecord> {
  if (!database)
    throw workflowServiceError(
      "DATABASE_UNAVAILABLE",
      "Blueprint registry access is not configured.",
    );
  if (!/^[a-z0-9][a-z0-9._:-]{0,159}$/iu.test(blueprintId.trim()))
    throw workflowServiceError(
      "WORKFLOW_BLUEPRINT_NOT_FOUND",
      "The requested Blueprint is not available in this scope.",
    );
  if (
    !isJsonObject(request) ||
    request.contractVersion !== ContractVersion.WorkflowBlueprintLifecycle ||
    ![
      "create_revision",
      "duplicate",
      "deprecate",
      "restore",
      "mark_current",
    ].includes(request.action)
  )
    throw workflowServiceError(
      "WORKFLOW_BLUEPRINT_LIFECYCLE_INVALID",
      "A supported Blueprint lifecycle action is required.",
    );

  const row = await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      const sourceVersion = request.sourceVersion?.trim();
      const query = db
        .select()
        .from(workflowBlueprints)
        .where(
          and(
            eq(workflowBlueprints.organizationId, principal.organizationId),
            eq(workflowBlueprints.blueprintId, blueprintId.trim()),
            isNull(workflowBlueprints.deletedAt),
            ...(sourceVersion
              ? [eq(workflowBlueprints.version, sourceVersion)]
              : []),
          ),
        )
        .orderBy(desc(workflowBlueprints.updatedAt))
        .limit(1);
      const [candidate] = await query;
      return candidate ?? null;
    },
  );
  if (
    !row ||
    (request.action === "restore"
      ? row.status !== "retired"
      : row.status !== "approved")
  ) {
    throw workflowServiceError(
      "WORKFLOW_BLUEPRINT_NOT_FOUND",
      request.action === "restore"
        ? "Only an archived Blueprint revision can be restored through the lifecycle workflow."
        : "Only an approved Blueprint revision can be changed through the lifecycle workflow.",
    );
  }
  const source = parseWorkflowBlueprint(row.blueprint);
  if (!source)
    throw workflowServiceError(
      "BLUEPRINT_INVALID",
      `Blueprint ${row.blueprintId}@${row.version} is invalid.`,
    );
  const plan = buildPlan(principal, request, source, row.version);
  return submitWorkflowPlan(principal, plan);
}
