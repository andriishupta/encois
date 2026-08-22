import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  ContractVersion,
  isJsonObject,
  parseWorkflowBlueprint,
  TemporalWorkflowType,
  WorkflowStepKind,
  resolveEffectiveScope,
  type JsonObject,
  type WorkflowBlueprint,
  type WorkflowBlueprintProjection,
  type WorkflowChangePlan,
  type WorkflowCreationIntent,
  type WorkflowCreationPreview,
  type WorkflowProviderBindingProjection,
  type WorkflowTemplate,
} from "@encois/contracts";
import { integrationBindings, integrations, membershipScopes, organizationMemberships, organizationUnits, workflowBlueprints, withOrganizationContext } from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { database } from "../../database.js";
import { listWorkflowTemplatesForPrincipal } from "./workflow-template.service.js";
import { workflowServiceError } from "./workflow.service.js";

function slug(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return (normalized || fallback).slice(0, 72);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isJsonObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function planId(principal: AosPrincipal, intent: WorkflowCreationIntent, blueprint: WorkflowBlueprint): string {
  const digest = createHash("sha256")
    .update(stableSerialize({ organizationId: principal.organizationId, intent, blueprint }))
    .digest("hex")
    .slice(0, 20);
  return `plan:${slug(intent.businessKey ?? intent.name, "workflow")}:${digest}`;
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
  const bindingBySlot = new Map(bindings.filter((binding) => binding.status === "ready").map((binding) => [binding.slotKey, binding]));
  const steps = template.steps.map((step) => ({
    id: step.id,
    kind: step.kind as WorkflowStepKind,
    ...(step.tool ? { tool: step.tool } : {}),
    ...(step.agentDefinition ? { agentDefinition: step.agentDefinition } : {}),
    ...(step.dependsOn ? { dependsOn: [...step.dependsOn] } : {}),
    ...(step.input || step.providerSlot
      ? { input: { ...(step.input ?? {}), ...(step.providerSlot ? { providerSlot: step.providerSlot, ...(bindingBySlot.get(step.providerSlot)?.provider ? { provider: bindingBySlot.get(step.providerSlot)?.provider } : {}), ...(bindingBySlot.get(step.providerSlot)?.integrationName ? { integrationName: bindingBySlot.get(step.providerSlot)?.integrationName } : {}) } : {}) } }
      : {}),
    ...(step.requiresApproval ? { requiresApproval: true } : {}),
  }));
  const requiresApproval = steps.some((step) => step.requiresApproval === true);
  return {
    contractVersion: ContractVersion.WorkflowBlueprint,
    blueprintId: `${workflowKey(intent)}-blueprint`,
    version: "1.0.0",
    name: intent.name.trim(),
    workflowType: TemporalWorkflowType.UserBlueprint,
    purpose: intent.description?.trim() || purpose,
    enabled: true,
    steps,
    ...(requiresApproval ? { requiresApproval: true } : {}),
  };
}

function blueprintFromStoredRow(row: typeof workflowBlueprints.$inferSelect): WorkflowBlueprint {
  const blueprint = parseWorkflowBlueprint(row.blueprint);
  if (!blueprint) throw workflowServiceError("BLUEPRINT_INVALID", `Blueprint ${row.blueprintId}@${row.version} is invalid.`);
  return blueprint;
}

function previewFromPlan(
  intent: WorkflowCreationIntent,
  blueprint: WorkflowBlueprint,
  source: WorkflowCreationPreview["source"],
  requiredCapabilities: readonly string[],
  providerBindings: readonly WorkflowProviderBindingProjection[],
): WorkflowCreationPreview {
  const plan: WorkflowChangePlan = {
    contractVersion: ContractVersion.WorkflowChangePlan,
    planId: "pending",
    coordinatorId: "pending",
    organizationId: "pending",
    observedAt: new Date().toISOString(),
    changes: [],
  };
  return {
    intent,
    plan,
    blueprint,
    source,
    warnings: [
      ...(providerBindings.some((binding) => binding.status === "missing" && !binding.required) ? ["Optional provider slots are not connected and will be skipped by the runtime."] : []),
      "The Blueprint is not persisted until the plan is approved and applied.",
    ],
    requiredCapabilities,
    providerBindings,
    approvalRequired: blueprint.requiresApproval === true,
  };
}

function providerCapabilities(provider: string): readonly string[] {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "github") return ["code.read", "pull-requests.read", "activity.read"];
  if (normalized === "jira") return ["issues.read", "activity.read"];
  // Keep workflow binding resolution aligned with the capabilities actually
  // registered by the current Agent Gateway. Other integrations may exist for
  // source ingestion, but must not appear executable in workflow creation.
  return [];
}

const runtimeToolCatalog = [
  { tool: "github.project_activity", provider: "github", capability: "code.read" },
  { tool: "github.repository_activity", provider: "github", capability: "code.read" },
  { tool: "jira.project_tasks", provider: "jira", capability: "issues.read" },
] as const;

function runtimeToolRequirement(tool: string): (typeof runtimeToolCatalog)[number] | undefined {
  return runtimeToolCatalog.find((candidate) => candidate.tool === tool);
}

const manualProviderCatalog = [
  { name: "github", matches: /github|pull request|repository|commit/u, capability: "code.read", tool: "github.repository_activity" },
  { name: "jira", matches: /jira|issue|ticket|sprint/u, capability: "issues.read", tool: "jira.project_tasks" },
] as const;

const unsupportedManualProviders = [
  { name: "linear", matches: /\blinear\b/u },
  { name: "google-drive", matches: /google drive|drive|document|docs|spec/u },
  { name: "slack", matches: /slack|message|conversation/u },
] as const;

function manualTemplate(intent: WorkflowCreationIntent): WorkflowTemplate {
  const prompt = intent.prompt?.trim();
  if (!prompt) throw workflowServiceError("MANUAL_PROMPT_REQUIRED", "Describe the outcome you want the workflow to investigate.");
  const normalized = prompt.toLowerCase();
  const unsupportedProvider = unsupportedManualProviders.find((provider) => provider.matches.test(normalized));
  if (unsupportedProvider) {
    throw workflowServiceError(
      "WORKFLOW_PROVIDER_UNSUPPORTED",
      `${unsupportedProvider.name} is not executable in the current Agent Gateway. Use GitHub or Jira, or select a published Template/approved Blueprint.`,
    );
  }
  const providers = manualProviderCatalog.filter((provider) => provider.matches.test(normalized));
  if (providers.length === 0) {
    throw workflowServiceError("MANUAL_PROVIDER_REQUIRED", "Describe a GitHub or Jira investigation so Encois can build an executable workflow plan.");
  }
  const providerSlots = providers.map((provider) => ({ key: `${provider.name}-context`, capabilities: [provider.capability], preferredProviders: [provider.name], required: true }));
  const collectionSteps = providers.map((provider) => ({ id: `collect-${provider.name}`, kind: WorkflowStepKind.Tool, tool: provider.tool, providerSlot: `${provider.name}-context` }));
  const collectIds = collectionSteps.map((step) => step.id);
  const requiresApproval = /approval|approve|production|release|deploy/u.test(normalized);
  return {
    schemaVersion: "workflow-template.v1",
    version: "1.0.0",
    workflowType: TemporalWorkflowType.UserBlueprint,
    purpose: prompt,
    inputs: { prompt: { type: "string", description: "The requested investigation outcome.", required: true } },
    providerSlots,
    steps: [
      ...collectionSteps,
      { id: "synthesize", kind: WorkflowStepKind.Agent, agentDefinition: "context.synthesizer@1", ...(collectIds.length ? { dependsOn: collectIds } : {}) },
      ...(requiresApproval ? [{ id: "approval", kind: WorkflowStepKind.Approval, dependsOn: ["synthesize"], requiresApproval: true }] : []),
    ],
    output: { type: "evidence-backed-investigation", description: "Evidence references, findings, unresolved gaps, and recommended next steps." },
  };
}

function bindingTemplateFromBlueprint(blueprint: WorkflowBlueprint): WorkflowTemplate {
  const providerSlots = new Map<string, { key: string; capabilities: Set<string>; preferredProviders: Set<string> }>();
  for (const step of blueprint.steps) {
    if (step.kind !== WorkflowStepKind.Tool || !step.tool) continue;
    const requirement = runtimeToolRequirement(step.tool);
    if (!requirement) {
      throw workflowServiceError("WORKFLOW_TOOL_UNSUPPORTED", `The approved Blueprint uses a tool that is not executable in the current Agent Gateway: ${step.tool}.`);
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
    output: { type: "evidence-backed-investigation", description: blueprint.purpose },
  };
}

async function resolveProviderBindings(
  principal: AosPrincipal,
  template: WorkflowTemplate,
): Promise<readonly WorkflowProviderBindingProjection[]> {
  if (!database) throw workflowServiceError("PERSISTENCE_UNAVAILABLE", "Integration capability registry access is not configured.");
  const rows = await withOrganizationContext(database, principal.organizationId, async (db) => {
    const [units, memberships, scopes, integrationsRows] = await Promise.all([
      db.select({ id: organizationUnits.id, parentId: organizationUnits.parentId, type: organizationUnits.type }).from(organizationUnits).where(eq(organizationUnits.organizationId, principal.organizationId)),
      db.select({ id: organizationMemberships.id }).from(organizationMemberships).where(and(eq(organizationMemberships.organizationId, principal.organizationId), eq(organizationMemberships.userId, principal.userId ?? principal.actorId), eq(organizationMemberships.status, "active"))),
      db.select({ membershipId: membershipScopes.membershipId, unitId: membershipScopes.organizationUnitId }).from(membershipScopes).where(eq(membershipScopes.organizationId, principal.organizationId)),
      db.select({ integrationId: integrations.id, integrationName: integrations.displayName, provider: integrations.provider, credentialRef: integrations.credentialRef, organizationUnitId: integrationBindings.organizationUnitId, grantedScopes: integrationBindings.grantedScopes })
        .from(integrations)
        .innerJoin(integrationBindings, and(eq(integrationBindings.integrationId, integrations.id), eq(integrationBindings.organizationId, principal.organizationId), eq(integrationBindings.status, "active")))
        .where(and(eq(integrations.organizationId, principal.organizationId), eq(integrations.status, "active"))),
    ]);
    const membershipUnitIds = scopes.filter((scope) => memberships.some((membership) => membership.id === scope.membershipId)).map((scope) => scope.unitId);
    const directUnitIds = membershipUnitIds.length > 0 ? membershipUnitIds : principal.scope.filter((scope) => scope !== "*");
    const effectiveUnitIds = new Set(resolveEffectiveScope({
      units: units.map((unit) => ({ id: unit.id, ...(unit.parentId ? { parentId: unit.parentId } : {}), type: unit.type })),
      directUnitIds: principal.scope.includes("*") ? units.map((unit) => unit.id) : directUnitIds,
    }).resolvedUnitIds);
    return integrationsRows
      .filter((row) => Boolean(row.credentialRef))
      .filter((row) => principal.scope.includes("*") || effectiveUnitIds.has(row.organizationUnitId));
  });
  const bindings: WorkflowProviderBindingProjection[] = [];
  for (const slot of template.providerSlots) {
    const match = rows.find((row) => {
      const preferred = slot.preferredProviders?.map((value) => value.toLowerCase());
      const provider = row.provider.toLowerCase();
      const capabilities = providerCapabilities(provider);
      return (!preferred || preferred.includes(provider)) && slot.capabilities.every((capability) => capabilities.includes(capability) && row.grantedScopes.includes(capability));
    });
    const binding: WorkflowProviderBindingProjection = {
      slotKey: slot.key,
      required: slot.required === true,
      status: match ? "ready" : "missing",
      capabilities: [...slot.capabilities],
      ...(match ? { provider: match.provider, integrationName: match.integrationName } : {}),
    };
    bindings.push(binding);
  }
  return bindings;
}

export function assertWorkflowProviderBindingsReady(bindings: readonly WorkflowProviderBindingProjection[]): void {
  const missing = bindings.find((binding) => binding.required && binding.status === "missing");
  if (!missing) return;
  throw workflowServiceError("INTEGRATION_CAPABILITY_MISSING", `Connect an active integration for the required ${missing.slotKey} capability before submitting this workflow plan.`);
}

async function resolveBlueprint(
  principal: AosPrincipal,
  intent: WorkflowCreationIntent,
): Promise<{ blueprint: WorkflowBlueprint; source: WorkflowCreationPreview["source"]; sourceSchemaVersion: string; requiredCapabilities: readonly string[]; providerBindings: readonly WorkflowProviderBindingProjection[] }> {
  if (intent.mode === "manual") {
    const template = manualTemplate(intent);
    const providerBindings = await resolveProviderBindings(principal, template);
    return {
      blueprint: blueprintFromTemplate(intent, template, template.purpose, providerBindings),
      source: { kind: "manual", title: "Manual planner" },
      sourceSchemaVersion: template.schemaVersion,
      requiredCapabilities: [...new Set(template.providerSlots.flatMap((slot) => slot.capabilities))],
      providerBindings,
    };
  }

  if (intent.mode === "template") {
    const key = intent.templateKey?.trim();
    if (!key) throw workflowServiceError("WORKFLOW_TEMPLATE_REQUIRED", "A published workflow Template is required.");
    const templates = await listWorkflowTemplatesForPrincipal(principal, { query: key, limit: 10 });
    const selected = templates.find((candidate) => candidate.key === key);
    if (!selected) throw workflowServiceError("WORKFLOW_TEMPLATE_NOT_FOUND", "The selected workflow Template is not available in this scope.");
    const providerBindings = await resolveProviderBindings(principal, selected.template as WorkflowTemplate);
    return {
      blueprint: blueprintFromTemplate(intent, selected.template as WorkflowTemplate, selected.template.purpose, providerBindings),
      source: { kind: "template", key: selected.key, title: selected.title },
      sourceSchemaVersion: selected.template.schemaVersion,
      requiredCapabilities: selected.requiredCapabilities,
      providerBindings,
    };
  }

  const key = intent.blueprintKey?.trim();
  if (!key) throw workflowServiceError("WORKFLOW_BLUEPRINT_REQUIRED", "An approved Blueprint is required.");
  if (!database) throw workflowServiceError("PERSISTENCE_UNAVAILABLE", "Blueprint registry access is not configured.");
  const row = await withOrganizationContext(database, principal.organizationId, async (db) => {
    const [candidate] = await db
      .select()
      .from(workflowBlueprints)
      .where(and(eq(workflowBlueprints.organizationId, principal.organizationId), eq(workflowBlueprints.blueprintId, key)))
      .orderBy(desc(workflowBlueprints.isCurrent), desc(workflowBlueprints.updatedAt))
      .limit(1);
    return candidate;
  });
  if (!row || row.status !== "approved") throw workflowServiceError("WORKFLOW_BLUEPRINT_NOT_FOUND", "The selected approved Blueprint is not available in this scope.");
  const blueprint = blueprintFromStoredRow(row);
  const bindingTemplate = bindingTemplateFromBlueprint(blueprint);
  const providerBindings = await resolveProviderBindings(principal, bindingTemplate);
  return {
    blueprint: { ...blueprint, name: intent.name.trim() || blueprint.name },
    source: { kind: "blueprint", key: row.blueprintId, title: row.name },
    sourceSchemaVersion: ContractVersion.WorkflowBlueprint,
    requiredCapabilities: [...new Set(bindingTemplate.providerSlots.flatMap((slot) => slot.capabilities))],
    providerBindings,
  };
}

export async function previewWorkflowCreation(
  principal: AosPrincipal,
  intent: WorkflowCreationIntent,
): Promise<WorkflowCreationPreview> {
  const name = intent.name.trim();
  if (name.length < 2 || name.length > 160) throw workflowServiceError("WORKFLOW_NAME_INVALID", "Workflow name must contain between 2 and 160 characters.");
  const resolved = await resolveBlueprint(principal, { ...intent, name });
  const preview = previewFromPlan({ ...intent, name }, resolved.blueprint, resolved.source, resolved.requiredCapabilities, resolved.providerBindings);
  const plan: WorkflowChangePlan = {
    contractVersion: ContractVersion.WorkflowChangePlan,
    planId: planId(principal, { ...intent, name }, resolved.blueprint),
    coordinatorId: `organization:${principal.organizationId}`,
    organizationId: principal.organizationId,
    scope: { ids: [...(intent.scope?.ids ?? principal.scope)] },
    observedAt: new Date().toISOString(),
    metadata: {
      planner: {
        name: intent.mode === "manual" ? "manual-workflow-planner" : "workflow-creator",
        version: "1.0.0",
      },
      sourceSchemaVersion: resolved.sourceSchemaVersion,
      ...(intent.prompt?.trim() ? {
        promptVersion: "workflow-creation-input.v1",
        promptHash: createHash("sha256").update(intent.prompt.trim()).digest("hex"),
      } : {}),
    },
    changes: [{
      kind: "create",
      blueprint: resolved.blueprint,
      start: intent.start ? { key: workflowKey(intent), businessInput: businessInput(intent) } : undefined,
      reason: intent.description?.trim() || resolved.blueprint.purpose,
      requiresApproval: resolved.blueprint.requiresApproval === true,
    }],
  };
  return { ...preview, plan };
}

export async function listWorkflowBlueprintsForPrincipal(
  principal: AosPrincipal,
): Promise<readonly WorkflowBlueprintProjection[]> {
  if (!database) throw workflowServiceError("PERSISTENCE_UNAVAILABLE", "Blueprint registry access is not configured.");
  const rows = await withOrganizationContext(database, principal.organizationId, (db) =>
    db
      .select()
      .from(workflowBlueprints)
      .where(eq(workflowBlueprints.organizationId, principal.organizationId))
      .orderBy(desc(workflowBlueprints.updatedAt)),
  );
  return rows.flatMap((row) => {
    const blueprint = parseWorkflowBlueprint(row.blueprint);
    if (!blueprint) return [];
    return [{
      blueprintId: row.blueprintId,
      version: row.version,
      name: row.name,
      purpose: blueprint.purpose,
      workflowType: blueprint.workflowType,
      status: row.status,
      isCurrent: row.isCurrent,
      ...(row.sourcePlanId ? { sourcePlanId: row.sourcePlanId } : {}),
      steps: blueprint.steps,
      ...(blueprint.requiredScopes ? { requiredScopes: blueprint.requiredScopes } : {}),
      ...(blueprint.requiresApproval !== undefined ? { requiresApproval: blueprint.requiresApproval } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    } satisfies WorkflowBlueprintProjection];
  });
}
