import {
  ContractVersion,
  CoordinatorEventType,
  type JsonObject,
  Permission,
  parseWorkflowBlueprint,
  resolveEffectiveScope,
  TemporalWorkflowType,
  type WorkflowBlueprint,
  type WorkflowBlueprintProjection,
  type WorkflowCreationIntent,
  type WorkflowCreationPreview,
  type WorkflowCreationResult,
  WorkflowExecutionStatus,
  type WorkflowProviderBindingProjection,
  WorkflowStepKind,
  type WorkflowTemplate,
} from "@encois/contracts";
import {
  auditEvents,
  integrationBindings,
  integrations,
  knowledgeSources,
  membershipScopes,
  organizationMemberships,
  organizationUnits,
  withOrganizationContext,
  workflowBlueprints,
  workflowDefinitions,
  workflowEvents,
  workflowRuns,
} from "@encois/database";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import {
  hasPermission,
  hasPermissions,
  isOrganizationAdministrator,
} from "../../auth/authorization.js";
import { database } from "../../database.js";
import type { AosPrincipal } from "../../middleware/aos.js";
import {
  organizationScopeCovers,
  organizationScopesOverlap,
} from "../../security/organization-scope.js";
import { type ListPage, type ListQuery, listPage } from "../list-query.js";
import { buildWorkflowId } from "../types.js";
import {
  coordinatorEventId,
  enqueueCoordinatorEvent,
} from "./coordinator-event.service.js";
import type { WorkflowServiceOptions } from "./workflow.service.js";
import {
  localUserId,
  stableSerialize,
  workflowServiceError,
} from "./workflow-service-common.js";
import { listWorkflowTemplatesForPrincipal } from "./workflow-template.service.js";

function slug(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  return (normalized || fallback).slice(0, 72);
}

function workflowKey(intent: WorkflowCreationIntent): string {
  return slug(intent.businessKey ?? intent.name, "workflow");
}

function businessInput(intent: WorkflowCreationIntent): JsonObject {
  if (intent.businessInput) return intent.businessInput;
  if (intent.prompt?.trim()) return { prompt: intent.prompt.trim() };
  return {};
}

function blueprintFromTemplate(
  intent: WorkflowCreationIntent,
  template: WorkflowTemplate,
  purpose: string,
  bindings: readonly WorkflowProviderBindingProjection[],
): WorkflowBlueprint {
  const bindingBySlot = new Map(
    bindings
      .filter((binding) => binding.status === "ready")
      .map((binding) => [binding.slotKey, binding]),
  );
  const steps = template.steps.map((step) => ({
    id: step.id,
    kind: step.kind as WorkflowStepKind,
    ...(step.tool ? { tool: step.tool } : {}),
    ...(step.agentDefinition ? { agentDefinition: step.agentDefinition } : {}),
    ...(step.dependsOn ? { dependsOn: [...step.dependsOn] } : {}),
    ...(step.input || step.providerSlot
      ? {
          input: {
            ...(step.input ?? {}),
            ...(step.providerSlot
              ? {
                  providerSlot: step.providerSlot,
                  ...(bindingBySlot.get(step.providerSlot)?.provider
                    ? {
                        provider: bindingBySlot.get(step.providerSlot)
                          ?.provider,
                      }
                    : {}),
                  ...(bindingBySlot.get(step.providerSlot)?.integrationName
                    ? {
                        integrationName: bindingBySlot.get(step.providerSlot)
                          ?.integrationName,
                      }
                    : {}),
                }
              : {}),
          },
        }
      : {}),
    ...(step.requiresApproval ? { requiresApproval: true } : {}),
  }));
  const requiresApproval = steps.some((step) => step.requiresApproval === true);
  return {
    contractVersion: ContractVersion.WorkflowBlueprint,
    blueprintId: `${workflowKey(intent)}-blueprint`,
    version: "1.0.0",
    name: intent.name.trim(),
    workflowType: TemporalWorkflowType.Dynamic,
    purpose: intent.description?.trim() || purpose,
    enabled: true,
    steps,
    ...(requiresApproval ? { requiresApproval: true } : {}),
  };
}

function blueprintFromStoredRow(
  row: typeof workflowBlueprints.$inferSelect,
): WorkflowBlueprint {
  const blueprint = parseWorkflowBlueprint(row.blueprint);
  if (!blueprint)
    throw workflowServiceError(
      "BLUEPRINT_INVALID",
      `Blueprint ${row.blueprintId}@${row.version} is invalid.`,
    );
  return blueprint;
}

function previewFromBlueprint(
  intent: WorkflowCreationIntent,
  blueprint: WorkflowBlueprint,
  source: WorkflowCreationPreview["source"],
  requiredCapabilities: readonly string[],
  providerBindings: readonly WorkflowProviderBindingProjection[],
): WorkflowCreationPreview {
  return {
    intent,
    blueprint,
    source,
    warnings: [
      ...(providerBindings.some(
        (binding) => binding.status === "missing" && !binding.required,
      )
        ? [
            "Optional provider slots are not connected and will be skipped by the runtime.",
          ]
        : []),
      "The Blueprint will be persisted when you create the workflow.",
    ],
    requiredCapabilities,
    providerBindings,
    approvalRequired: blueprint.requiresApproval === true,
  };
}

function providerCapabilities(provider: string): readonly string[] {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "github")
    return ["code.read", "pull-requests.read", "activity.read"];
  if (normalized === "jira") return ["issues.read", "activity.read"];
  // Keep workflow binding resolution aligned with the capabilities actually
  // registered by the current Agent Gateway. Other integrations may exist for
  // source ingestion, but must not appear executable in workflow creation.
  return [];
}

const runtimeToolCatalog = [
  {
    tool: "github.project_activity",
    provider: "github",
    capability: "code.read",
  },
  {
    tool: "github.repository_activity",
    provider: "github",
    capability: "code.read",
  },
  { tool: "jira.project_tasks", provider: "jira", capability: "issues.read" },
] as const;

function runtimeToolRequirement(
  tool: string,
): (typeof runtimeToolCatalog)[number] | undefined {
  return runtimeToolCatalog.find((candidate) => candidate.tool === tool);
}

function bindingTemplateFromBlueprint(
  blueprint: WorkflowBlueprint,
): WorkflowTemplate {
  const providerSlots = new Map<
    string,
    { key: string; capabilities: Set<string>; preferredProviders: Set<string> }
  >();
  for (const step of blueprint.steps) {
    if (step.kind !== WorkflowStepKind.Tool || !step.tool) continue;
    const requirement = runtimeToolRequirement(step.tool);
    if (!requirement) {
      throw workflowServiceError(
        "WORKFLOW_TOOL_UNSUPPORTED",
        `The approved Blueprint uses a tool that is not executable in the current Agent Gateway: ${step.tool}.`,
      );
    }
    const slotKey = `${requirement.provider}-context`;
    const existing = providerSlots.get(slotKey) ?? {
      key: slotKey,
      capabilities: new Set<string>(),
      preferredProviders: new Set<string>(),
    };
    existing.capabilities.add(requirement.capability);
    existing.preferredProviders.add(requirement.provider);
    providerSlots.set(slotKey, existing);
  }

  return {
    schemaVersion: "workflow-template.v1",
    version: blueprint.version,
    workflowType: blueprint.workflowType,
    purpose: blueprint.purpose,
    inputs: {},
    providerSlots: [...providerSlots.values()].map((slot) => ({
      key: slot.key,
      capabilities: [...slot.capabilities],
      preferredProviders: [...slot.preferredProviders],
      required: true,
    })),
    steps: [],
    output: {
      type: "evidence-backed-investigation",
      description: blueprint.purpose,
    },
  };
}

async function resolveProviderBindings(
  principal: AosPrincipal,
  template: WorkflowTemplate,
  requestedScopeIds?: readonly string[],
): Promise<readonly WorkflowProviderBindingProjection[]> {
  if (!database)
    throw workflowServiceError(
      "DATABASE_UNAVAILABLE",
      "Integration capability registry access is not configured.",
    );
  const resolved = await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (
        !(await hasPermissions(db, principal, [
          Permission.WorkflowsRead,
          Permission.IntegrationsRead,
        ]))
      ) {
        throw workflowServiceError(
          "FORBIDDEN",
          "The user is not allowed to preview workflow provider bindings.",
        );
      }
      const [
        units,
        memberships,
        scopes,
        integrationsRows,
        sourceRows,
        organizationWide,
      ] = await Promise.all([
        db
          .select({
            id: organizationUnits.id,
            parentId: organizationUnits.parentId,
            type: organizationUnits.type,
          })
          .from(organizationUnits)
          .where(
            eq(organizationUnits.organizationId, principal.organizationId),
          ),
        db
          .select({ id: organizationMemberships.id })
          .from(organizationMemberships)
          .where(
            and(
              eq(
                organizationMemberships.organizationId,
                principal.organizationId,
              ),
              eq(
                organizationMemberships.userId,
                principal.userId ?? principal.actorId,
              ),
              eq(organizationMemberships.status, "active"),
            ),
          ),
        db
          .select({
            membershipId: membershipScopes.membershipId,
            unitId: membershipScopes.organizationUnitId,
          })
          .from(membershipScopes)
          .where(eq(membershipScopes.organizationId, principal.organizationId)),
        db
          .select({
            integrationId: integrations.id,
            integrationName: integrations.displayName,
            provider: integrations.provider,
            credentialRef: integrations.credentialRef,
            organizationUnitId: integrationBindings.organizationUnitId,
            grantedScopes: integrationBindings.grantedScopes,
          })
          .from(integrations)
          .innerJoin(
            integrationBindings,
            and(
              eq(integrationBindings.integrationId, integrations.id),
              eq(integrationBindings.organizationId, principal.organizationId),
              eq(integrationBindings.status, "active"),
            ),
          )
          .where(
            and(
              eq(integrations.organizationId, principal.organizationId),
              eq(integrations.status, "active"),
            ),
          ),
        db
          .select({
            integrationId: knowledgeSources.integrationId,
            provider: knowledgeSources.provider,
            status: knowledgeSources.status,
            readScope: knowledgeSources.readScope,
            visibilityScope: knowledgeSources.visibilityScope,
          })
          .from(knowledgeSources)
          .where(
            and(
              eq(knowledgeSources.organizationId, principal.organizationId),
              eq(knowledgeSources.kind, "integration"),
            ),
          ),
        isOrganizationAdministrator(db, principal),
      ]);
      const membershipUnitIds = scopes
        .filter((scope) =>
          memberships.some(
            (membership) => membership.id === scope.membershipId,
          ),
        )
        .map((scope) => scope.unitId);
      const directUnitIds = organizationWide
        ? units.map((unit) => unit.id)
        : membershipUnitIds.length > 0
          ? membershipUnitIds
          : principal.scope.filter((scope) => scope !== "*");
      const effectiveUnitIds = new Set(
        resolveEffectiveScope({
          units: units.map((unit) => ({
            id: unit.id,
            ...(unit.parentId ? { parentId: unit.parentId } : {}),
            type: unit.type,
          })),
          directUnitIds:
            organizationWide || principal.scope.includes("*")
              ? units.map((unit) => unit.id)
              : directUnitIds,
        }).resolvedUnitIds,
      );
      const executionScope = requestedScopeIds?.length
        ? requestedScopeIds
        : organizationWide || principal.scope.includes("*")
          ? units.map((unit) => unit.id)
          : principal.scope;
      if (
        !organizationScopeCovers(
          units,
          organizationWide ? ["*"] : principal.scope,
          executionScope,
        )
      ) {
        throw workflowServiceError(
          "SCOPE_DENIED",
          "The requested workflow scope exceeds the caller's organization-unit scope.",
        );
      }
      const accessibleSources = sourceRows
        .filter(
          (source) =>
            Boolean(source.integrationId) && source.status === "active",
        )
        .filter(
          (source) =>
            organizationScopesOverlap(units, source.readScope.ids, [
              ...effectiveUnitIds,
            ]) &&
            organizationScopesOverlap(units, source.visibilityScope.ids, [
              ...effectiveUnitIds,
            ]),
        );
      return {
        units,
        executionScope,
        sources: accessibleSources,
        rows: integrationsRows
          .filter((row) => Boolean(row.credentialRef))
          .filter((row) =>
            organizationScopesOverlap(
              units,
              [row.organizationUnitId],
              [...effectiveUnitIds],
            ),
          )
          .filter((row) =>
            organizationScopeCovers(
              units,
              [row.organizationUnitId],
              executionScope,
            ),
          ),
      };
    },
  );
  const { units, executionScope, sources, rows } = resolved;
  const bindings: WorkflowProviderBindingProjection[] = [];
  for (const slot of template.providerSlots) {
    const match = rows.find((row) => {
      const preferred = slot.preferredProviders?.map((value) =>
        value.toLowerCase(),
      );
      const provider = row.provider.toLowerCase();
      const capabilities = providerCapabilities(provider);
      const providerSources = sources.filter(
        (source) =>
          source.integrationId === row.integrationId &&
          source.provider?.toLowerCase() === provider,
      );
      const sourceReadScopeIds = providerSources.flatMap(
        (source) => source.readScope.ids,
      );
      const sourceVisibilityScopeIds = providerSources.flatMap(
        (source) => source.visibilityScope.ids,
      );
      return (
        (!preferred || preferred.includes(provider)) &&
        sourceReadScopeIds.length > 0 &&
        sourceVisibilityScopeIds.length > 0 &&
        organizationScopeCovers(units, sourceReadScopeIds, executionScope) &&
        organizationScopeCovers(
          units,
          sourceVisibilityScopeIds,
          executionScope,
        ) &&
        slot.capabilities.every(
          (capability) =>
            capabilities.includes(capability) &&
            row.grantedScopes.includes(capability),
        )
      );
    });
    const binding: WorkflowProviderBindingProjection = {
      slotKey: slot.key,
      required: slot.required === true,
      status: match ? "ready" : "missing",
      capabilities: [...slot.capabilities],
      ...(match
        ? { provider: match.provider, integrationName: match.integrationName }
        : {}),
    };
    bindings.push(binding);
  }
  return bindings;
}

export function assertWorkflowProviderBindingsReady(
  bindings: readonly WorkflowProviderBindingProjection[],
): void {
  const missing = bindings.find(
    (binding) => binding.required && binding.status === "missing",
  );
  if (!missing) return;
  throw workflowServiceError(
    "INTEGRATION_CAPABILITY_MISSING",
    `Configure a matching Source in the selected scope for the required ${missing.slotKey} capability before creating this workflow.`,
  );
}

async function resolveBlueprint(
  principal: AosPrincipal,
  intent: WorkflowCreationIntent,
): Promise<{
  blueprint: WorkflowBlueprint;
  source: WorkflowCreationPreview["source"];
  requiredCapabilities: readonly string[];
  providerBindings: readonly WorkflowProviderBindingProjection[];
}> {
  if (intent.mode === "manual") {
    throw workflowServiceError(
      "WORKFLOW_MANUAL_UNAVAILABLE",
      "AI-generated workflows are coming soon. Select an active Template or approved Blueprint.",
    );
  }

  if (intent.mode === "template") {
    const key = intent.templateKey?.trim();
    if (!key)
      throw workflowServiceError(
        "WORKFLOW_TEMPLATE_REQUIRED",
        "An active workflow Template is required.",
      );
    const templates = await listWorkflowTemplatesForPrincipal(principal, {
      query: key,
      limit: 10,
    });
    const selected = templates.find((candidate) => candidate.key === key);
    if (!selected)
      throw workflowServiceError(
        "WORKFLOW_TEMPLATE_NOT_FOUND",
        "The selected workflow Template is not available in this scope.",
      );
    if (selected.status !== "active")
      throw workflowServiceError(
        "WORKFLOW_TEMPLATE_DISABLED",
        "This workflow Template is coming soon and cannot be used yet.",
      );
    const providerBindings = await resolveProviderBindings(
      principal,
      selected.template as WorkflowTemplate,
      intent.scope?.ids,
    );
    return {
      blueprint: blueprintFromTemplate(
        intent,
        selected.template as WorkflowTemplate,
        selected.template.purpose,
        providerBindings,
      ),
      source: { kind: "template", key: selected.key, title: selected.title },
      requiredCapabilities: selected.requiredCapabilities,
      providerBindings,
    };
  }

  const key = intent.blueprintKey?.trim();
  if (!key)
    throw workflowServiceError(
      "WORKFLOW_BLUEPRINT_REQUIRED",
      "An approved Blueprint is required.",
    );
  if (!database)
    throw workflowServiceError(
      "DATABASE_UNAVAILABLE",
      "Blueprint registry access is not configured.",
    );
  const row = await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      const [candidate] = await db
        .select()
        .from(workflowBlueprints)
        .where(
          and(
            eq(workflowBlueprints.organizationId, principal.organizationId),
            eq(workflowBlueprints.blueprintId, key),
            isNull(workflowBlueprints.deletedAt),
          ),
        )
        .orderBy(
          desc(workflowBlueprints.isCurrent),
          desc(workflowBlueprints.updatedAt),
        )
        .limit(1);
      return candidate;
    },
  );
  if (row?.status !== "approved")
    throw workflowServiceError(
      "WORKFLOW_BLUEPRINT_NOT_FOUND",
      "The selected approved Blueprint is not available in this scope.",
    );
  const blueprint = blueprintFromStoredRow(row);
  const bindingTemplate = bindingTemplateFromBlueprint(blueprint);
  const providerBindings = await resolveProviderBindings(
    principal,
    bindingTemplate,
    intent.scope?.ids,
  );
  return {
    blueprint,
    source: { kind: "blueprint", key: row.blueprintId, title: row.name },
    requiredCapabilities: [
      ...new Set(
        bindingTemplate.providerSlots.flatMap((slot) => slot.capabilities),
      ),
    ],
    providerBindings,
  };
}

export async function previewWorkflowCreation(
  principal: AosPrincipal,
  intent: WorkflowCreationIntent,
): Promise<WorkflowCreationPreview> {
  const name = intent.name.trim();
  if (name.length < 2 || name.length > 160)
    throw workflowServiceError(
      "WORKFLOW_NAME_INVALID",
      "Workflow name must contain between 2 and 160 characters.",
    );
  const resolved = await resolveBlueprint(principal, { ...intent, name });
  const preview = previewFromBlueprint(
    { ...intent, name },
    resolved.blueprint,
    resolved.source,
    resolved.requiredCapabilities,
    resolved.providerBindings,
  );
  return preview;
}

function blueprintProjection(
  row: typeof workflowBlueprints.$inferSelect,
): WorkflowBlueprintProjection {
  const blueprint = parseWorkflowBlueprint(row.blueprint);
  if (!blueprint)
    throw workflowServiceError(
      "BLUEPRINT_INVALID",
      `Blueprint ${row.blueprintId}@${row.version} is invalid.`,
    );
  return {
    blueprintId: row.blueprintId,
    version: row.version,
    name: row.name,
    purpose: blueprint.purpose,
    workflowType: blueprint.workflowType,
    status: row.status,
    isCurrent: row.isCurrent,
    steps: blueprint.steps,
    ...(blueprint.requiredScopes
      ? { requiredScopes: blueprint.requiredScopes }
      : {}),
    ...(blueprint.requiresApproval !== undefined
      ? { requiresApproval: blueprint.requiresApproval }
      : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
  };
}

export async function createWorkflowFromIntent(
  principal: AosPrincipal,
  intent: WorkflowCreationIntent,
  options: WorkflowServiceOptions,
): Promise<WorkflowCreationResult> {
  if (!database)
    throw workflowServiceError(
      "DATABASE_UNAVAILABLE",
      "Blueprint registry access is not configured.",
    );
  const userId = localUserId(principal);
  if (!userId)
    throw workflowServiceError(
      "IDENTITY_NOT_RESOLVED",
      "The identity is not linked to a local user.",
    );
  const preview = await previewWorkflowCreation(principal, intent);
  assertWorkflowProviderBindingsReady(preview.providerBindings);
  const blueprint = await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (!(await hasPermission(db, principal, Permission.WorkflowsManage)))
        throw workflowServiceError(
          "FORBIDDEN",
          "The user cannot create workflow Blueprints.",
        );
      if (preview.source.kind === "blueprint") {
        const [stored] = await db
          .select()
          .from(workflowBlueprints)
          .where(
            and(
              eq(workflowBlueprints.organizationId, principal.organizationId),
              eq(workflowBlueprints.blueprintId, preview.blueprint.blueprintId),
              eq(workflowBlueprints.version, preview.blueprint.version),
              eq(workflowBlueprints.status, "approved"),
              isNull(workflowBlueprints.deletedAt),
            ),
          )
          .limit(1);
        if (!stored)
          throw workflowServiceError(
            "WORKFLOW_BLUEPRINT_NOT_FOUND",
            "The selected approved Blueprint is no longer available.",
          );
        return blueprintProjection(stored);
      }

      await db
        .insert(workflowDefinitions)
        .values({
          organizationId: principal.organizationId,
          key: preview.blueprint.workflowType,
          version: "v1",
          status: "approved",
          inputSchemaRef: preview.blueprint.inputSchemaRef,
          outputSchemaRef: preview.blueprint.outputSchemaRef,
        })
        .onConflictDoNothing();

      const [existing] = await db
        .select()
        .from(workflowBlueprints)
        .where(
          and(
            eq(workflowBlueprints.organizationId, principal.organizationId),
            eq(workflowBlueprints.blueprintId, preview.blueprint.blueprintId),
            eq(workflowBlueprints.version, preview.blueprint.version),
            isNull(workflowBlueprints.deletedAt),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          existing.status !== "approved" ||
          stableSerialize(existing.blueprint) !==
            stableSerialize(preview.blueprint)
        )
          throw workflowServiceError(
            "WORKFLOW_BLUEPRINT_CONFLICT",
            `Blueprint ${preview.blueprint.blueprintId}@${preview.blueprint.version} already exists with different content.`,
          );
        return blueprintProjection(existing);
      }

      const now = new Date();
      const [created] = await db
        .insert(workflowBlueprints)
        .values({
          organizationId: principal.organizationId,
          blueprintId: preview.blueprint.blueprintId,
          version: preview.blueprint.version,
          workflowType: preview.blueprint.workflowType,
          name: preview.blueprint.name,
          blueprint: preview.blueprint as unknown as Record<string, unknown>,
          status: "approved",
          isCurrent: true,
          approvedAt: now,
        })
        .returning();
      if (!created)
        throw workflowServiceError(
          "BLUEPRINT_DATABASE_FAILED",
          "The workflow Blueprint could not be persisted.",
        );
      await db.insert(auditEvents).values({
        organizationId: principal.organizationId,
        actorUserId: userId,
        action: "workflow_blueprint_created",
        outcome: "accepted",
        resourceType: "workflow_blueprint",
        resourceId: `${created.blueprintId}@${created.version}`,
        scope: { ids: principal.scope },
        metadata: {
          source: preview.source.kind,
          sourceKey: preview.source.key,
        },
      });
      return blueprintProjection(created);
    },
  );

  if (!intent.start) return { blueprint };
  const key = workflowKey(intent);
  const scope = {
    ids: [...new Set(intent.scope?.ids ?? principal.scope)].sort(),
  };
  if (scope.ids.length === 0)
    throw workflowServiceError(
      "INVALID_SCOPE",
      "Execution scope must contain at least one organization-unit id.",
    );
  const workflowId = buildWorkflowId({
    organizationId: principal.organizationId,
    organizationUnitId: scope.ids[0] ?? principal.organizationId,
    key,
  });
  const input = businessInput(intent);
  const workflow = await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (!(await hasPermission(db, principal, Permission.WorkflowsRun)))
        throw workflowServiceError(
          "FORBIDDEN",
          "The user cannot start workflows.",
        );
      const [definition] = await db
        .select({ id: workflowDefinitions.id })
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.key, blueprint.workflowType),
            eq(workflowDefinitions.version, "v1"),
            eq(workflowDefinitions.status, "approved"),
            or(
              isNull(workflowDefinitions.organizationId),
              eq(workflowDefinitions.organizationId, principal.organizationId),
            ),
          ),
        )
        .limit(1);
      if (!definition)
        throw workflowServiceError(
          "WORKFLOW_DEFINITION_NOT_FOUND",
          `No approved workflow definition exists for ${blueprint.workflowType}@v1.`,
        );

      const [existing] = await db
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.organizationId, principal.organizationId),
            eq(workflowRuns.temporalWorkflowId, workflowId),
          ),
        )
        .limit(1);
      const now = new Date();
      const retentionUntil = new Date(
        now.getTime() +
          (options.workflowRunRetentionDays ?? 30) * 24 * 60 * 60 * 1000,
      );
      const run =
        existing ??
        (
          await db
            .insert(workflowRuns)
            .values({
              organizationId: principal.organizationId,
              definitionId: definition.id,
              actorUserId: userId,
              temporalNamespace: options.namespace,
              temporalTaskQueue: options.taskQueue,
              temporalWorkflowId: workflowId,
              blueprintId: blueprint.blueprintId,
              blueprintVersion: blueprint.version,
              trigger: "manual",
              status: WorkflowExecutionStatus.Queued,
              scope,
              businessInput: input,
              retentionUntil,
            })
            .returning()
        )[0];
      if (!run)
        throw workflowServiceError(
          "WORKFLOW_DATABASE_FAILED",
          "The queued Workflow could not be persisted.",
        );
      const eventId = coordinatorEventId("workflow-start", workflowId);
      try {
        await enqueueCoordinatorEvent(
          db,
          {
            organizationId: principal.organizationId,
            eventId,
            eventType: CoordinatorEventType.WorkflowStartRequested,
            actorId: principal.actorId,
            blueprintId: blueprint.blueprintId,
            blueprintVersion: blueprint.version,
            workflowId,
            key,
            businessInput: input,
            scope,
            reason: "Start the approved Blueprint selected by the user.",
          },
          { requireReady: true },
        );
      } catch (error) {
        if (error instanceof Error && error.message === "COORDINATOR_NOT_READY")
          throw workflowServiceError(
            "COORDINATOR_NOT_READY",
            "The workspace Coordinator must be ready before starting a Workflow.",
          );
        throw error;
      }
      if (!existing) {
        await db.insert(workflowEvents).values({
          organizationId: principal.organizationId,
          workflowRunId: run.id,
          eventType: "workflow_start_requested",
          status: WorkflowExecutionStatus.Queued,
          metadata: { eventId, source: "coordinator_outbox" },
          occurredAt: now,
        });
      }
      return {
        workflowId,
        workflowType: blueprint.workflowType,
        blueprintId: blueprint.blueprintId,
        blueprintVersion: blueprint.version,
        trigger: run.trigger ?? "manual",
        namespace: run.temporalNamespace ?? options.namespace,
        taskQueue: run.temporalTaskQueue ?? options.taskQueue,
        status:
          run.status === WorkflowExecutionStatus.Queued
            ? WorkflowExecutionStatus.Preparing
            : run.status,
        ...(run.status === WorkflowExecutionStatus.Queued
          ? {
              statusMessage:
                "The Coordinator is preparing the Temporal workflow execution.",
            }
          : {}),
        organizationId: principal.organizationId,
        scope,
        reused: Boolean(existing),
        ...(run.retentionUntil
          ? { retentionUntil: run.retentionUntil.toISOString() }
          : {}),
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
      };
    },
  );
  return { blueprint, workflow };
}

export async function listWorkflowBlueprintsForPrincipal(
  principal: AosPrincipal,
): Promise<readonly WorkflowBlueprintProjection[]> {
  return (
    await listWorkflowBlueprintsPageForPrincipal(principal, {
      sort: "updated-desc",
      limit: 50,
      offset: 0,
    })
  ).items;
}

export async function listWorkflowBlueprintsPageForPrincipal(
  principal: AosPrincipal,
  query: ListQuery,
): Promise<ListPage<WorkflowBlueprintProjection>> {
  if (!database)
    throw workflowServiceError(
      "DATABASE_UNAVAILABLE",
      "Blueprint registry access is not configured.",
    );
  const rows = await withOrganizationContext(
    database,
    principal.organizationId,
    (db) =>
      db
        .select()
        .from(workflowBlueprints)
        .where(
          and(
            eq(workflowBlueprints.organizationId, principal.organizationId),
            isNull(workflowBlueprints.deletedAt),
          ),
        ),
  );
  const projections = rows.flatMap((row) => {
    const blueprint = parseWorkflowBlueprint(row.blueprint);
    if (!blueprint) return [];
    return [
      {
        blueprintId: row.blueprintId,
        version: row.version,
        name: row.name,
        purpose: blueprint.purpose,
        workflowType: blueprint.workflowType,
        status: row.status,
        isCurrent: row.isCurrent,
        steps: blueprint.steps,
        ...(blueprint.requiredScopes
          ? { requiredScopes: blueprint.requiredScopes }
          : {}),
        ...(blueprint.requiresApproval !== undefined
          ? { requiresApproval: blueprint.requiresApproval }
          : {}),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
      } satisfies WorkflowBlueprintProjection,
    ];
  });
  const normalizedQuery = query.query?.toLowerCase();
  const filtered = projections.filter((blueprint) => {
    if (query.status && blueprint.status !== query.status) return false;
    if (!normalizedQuery) return true;
    return [
      blueprint.name,
      blueprint.purpose,
      blueprint.blueprintId,
      blueprint.status,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  const sorted = [...filtered].sort((left, right) => {
    if (query.sort === "updated-asc")
      return left.updatedAt.localeCompare(right.updatedAt);
    if (query.sort === "name-asc") return left.name.localeCompare(right.name);
    if (query.sort === "status")
      return (
        left.status.localeCompare(right.status) ||
        right.updatedAt.localeCompare(left.updatedAt)
      );
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  return listPage(sorted, query);
}

/**
 * A Workflow definition is the stable blueprintId grouping in the current
 * control-plane model. Deleting it hides every persisted revision in that
 * group while leaving historical Run projections intact.
 */
export async function deleteWorkflowDefinitionForPrincipal(
  principal: AosPrincipal,
  blueprintId: string,
): Promise<void> {
  if (!database)
    throw workflowServiceError(
      "DATABASE_UNAVAILABLE",
      "Blueprint registry access is not configured.",
    );
  const userId = localUserId(principal);
  if (!userId)
    throw workflowServiceError(
      "IDENTITY_NOT_RESOLVED",
      "The identity is not linked to a local user.",
    );

  await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (!(await hasPermission(db, principal, Permission.WorkflowsManage)))
        throw workflowServiceError(
          "FORBIDDEN",
          "The user cannot delete Workflow definitions.",
        );

      const rows = await db
        .select({
          id: workflowBlueprints.id,
          blueprintId: workflowBlueprints.blueprintId,
          version: workflowBlueprints.version,
          status: workflowBlueprints.status,
        })
        .from(workflowBlueprints)
        .where(
          and(
            eq(workflowBlueprints.organizationId, principal.organizationId),
            eq(workflowBlueprints.blueprintId, blueprintId),
            isNull(workflowBlueprints.deletedAt),
          ),
        );
      if (rows.length === 0)
        throw workflowServiceError(
          "WORKFLOW_BLUEPRINT_NOT_FOUND",
          "The Workflow definition was not found.",
        );

      const now = new Date();
      const deleted = await db
        .update(workflowBlueprints)
        .set({ deletedAt: now, isCurrent: false, updatedAt: now })
        .where(
          and(
            eq(workflowBlueprints.organizationId, principal.organizationId),
            eq(workflowBlueprints.blueprintId, blueprintId),
            isNull(workflowBlueprints.deletedAt),
          ),
        )
        .returning({ id: workflowBlueprints.id });
      if (deleted.length !== rows.length)
        throw workflowServiceError(
          "WORKFLOW_BLUEPRINT_DELETE_CONFLICT",
          "The Workflow definition changed concurrently.",
        );

      await db.insert(auditEvents).values({
        organizationId: principal.organizationId,
        actorUserId: userId,
        action: "workflow_definition_deleted",
        outcome: "accepted",
        resourceType: "workflow_definition",
        resourceId: blueprintId,
        scope: { ids: principal.scope },
        metadata: {
          deletedVersions: rows.map((row) => row.version),
          previousStatuses: rows.map((row) => row.status),
        },
      });
    },
  );
}

export async function deleteWorkflowBlueprintRevisionForPrincipal(
  principal: AosPrincipal,
  blueprintId: string,
  version: string,
): Promise<void> {
  if (!database)
    throw workflowServiceError(
      "DATABASE_UNAVAILABLE",
      "Blueprint registry access is not configured.",
    );
  const userId = localUserId(principal);
  if (!userId)
    throw workflowServiceError(
      "IDENTITY_NOT_RESOLVED",
      "The identity is not linked to a local user.",
    );

  await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (!(await hasPermission(db, principal, Permission.WorkflowsManage)))
        throw workflowServiceError(
          "FORBIDDEN",
          "The user cannot delete Blueprint revisions.",
        );

      const [row] = await db
        .select({
          id: workflowBlueprints.id,
          version: workflowBlueprints.version,
          status: workflowBlueprints.status,
          isCurrent: workflowBlueprints.isCurrent,
        })
        .from(workflowBlueprints)
        .where(
          and(
            eq(workflowBlueprints.organizationId, principal.organizationId),
            eq(workflowBlueprints.blueprintId, blueprintId),
            eq(workflowBlueprints.version, version),
            isNull(workflowBlueprints.deletedAt),
          ),
        )
        .limit(1);

      if (!row)
        throw workflowServiceError(
          "WORKFLOW_BLUEPRINT_NOT_FOUND",
          "The Blueprint revision was not found.",
        );
      if (row.isCurrent)
        throw workflowServiceError(
          "WORKFLOW_BLUEPRINT_CURRENT_NOT_DELETABLE",
          "The current Blueprint revision cannot be deleted. Publish another revision first.",
        );

      const now = new Date();
      const [deleted] = await db
        .update(workflowBlueprints)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(workflowBlueprints.id, row.id),
            eq(workflowBlueprints.organizationId, principal.organizationId),
            isNull(workflowBlueprints.deletedAt),
          ),
        )
        .returning({ id: workflowBlueprints.id });
      if (!deleted)
        throw workflowServiceError(
          "WORKFLOW_BLUEPRINT_DELETE_CONFLICT",
          "The Blueprint revision changed concurrently.",
        );

      await db.insert(auditEvents).values({
        organizationId: principal.organizationId,
        actorUserId: userId,
        action: "workflow_blueprint_revision_deleted",
        outcome: "accepted",
        resourceType: "workflow_blueprint",
        resourceId: `${blueprintId}@${version}`,
        scope: { ids: principal.scope },
        metadata: {
          version: row.version,
          previousStatus: row.status,
        },
      });
    },
  );
}
