import assert from "node:assert/strict";
import {
  ContractVersion,
  Permission,
  allPermissions,
  permissionIncludes,
  resolveEffectiveScope,
  ScopeRuleMode,
  TemporalWorkflowType,
  validateContract,
} from "./dist/src/index.js";

assert.equal(allPermissions.length, 15);
assert.equal(permissionIncludes([Permission.WorkflowsManage], Permission.WorkflowsRead), true);
assert.equal(permissionIncludes([Permission.IntegrationsRead], Permission.IntegrationsManage), false);
assert.equal(permissionIncludes([Permission.ContextRead], Permission.ContextRead), true);
assert.equal(permissionIncludes([Permission.OrganizationManage], Permission.ContextRead), false);

const effectiveScope = resolveEffectiveScope({
  units: [
    { id: "engineering", type: "organization" },
    { id: "checkout", parentId: "engineering", type: "team" },
    { id: "payments", parentId: "engineering", type: "service" },
    { id: "payments-api", parentId: "payments", type: "custom" },
  ],
  directUnitIds: ["checkout"],
  rules: [{ unitId: "payments", mode: ScopeRuleMode.Grant }],
});
assert.deepEqual(effectiveScope.resolvedUnitIds, ["checkout", "payments", "payments-api"]);

const blueprint = {
  contractVersion: ContractVersion.WorkflowBlueprint,
  blueprintId: "project-context",
  version: "1.0.0",
  name: "Project context",
  workflowType: TemporalWorkflowType.UserBlueprint,
  purpose: "Collect project context.",
  enabled: true,
  steps: [
    { id: "source", kind: "tool", tool: "jira.project_tasks" },
    { id: "summary", kind: "agent", agentDefinition: "context.synthesizer@1", dependsOn: ["source"] },
  ],
};

assert.equal(validateContract("workflowBlueprint", blueprint).valid, true);
assert.equal(
  validateContract("toolManifest", {
    contractVersion: "tool-manifest.v1",
    name: "jira.project_tasks",
    version: "1.0.0",
    kind: "tool",
    description: "Read project task status from Jira.",
    sideEffects: "read-only",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    requiredScope: ["ids"],
    available: true,
    approvalRequired: false,
  }).valid,
  true,
);
assert.equal(
  validateContract("artifactWrite", {
    contractVersion: "artifact-write.v1",
    requestId: "artifact-1",
    workflowId: "workflow:org-1:project-1",
    organizationId: "org-1",
    actorId: "actor-1",
    policyVersion: "policy-read-only-fixture-v1",
    capability: "test-capability",
    scope: { ids: ["team-1"] },
    objectKey: "evidence/release.json",
    contentType: "application/json",
    dataRef: "provider:jira:project-1",
  }).valid,
  true,
);
assert.equal(
  validateContract("graphQuery", {
    contractVersion: "graph-query.v1",
    requestId: "graph-1",
    workflowId: "workflow:org-1:project-1",
    organizationId: "org-1",
    actorId: "actor-1",
    policyVersion: "policy-read-only-fixture-v1",
    capability: "test-capability",
    scope: { ids: ["team-1"] },
    query: "project.related_entities",
    params: { projectKey: "checkout" },
  }).valid,
  true,
);
assert.equal(
  validateContract("graphQueryResult", {
    contractVersion: "graph-query-result.v1",
    requestId: "graph-1",
    status: "completed",
    nodes: [{ id: "project-1", type: "project", properties: { key: "checkout" } }],
    edges: [{ id: "edge-1", sourceId: "project-1", targetId: "team-1", relationship: "belongs_to", properties: {} }],
  }).valid,
  true,
);
assert.equal(
  validateContract("agentMemory", {
    contractVersion: "agent-memory.v1",
    requestId: "memory-1",
    workflowId: "workflow:org-1:project-1",
    organizationId: "org-1",
    actorId: "actor-1",
    policyVersion: "policy-read-only-fixture-v1",
    capability: "test-capability",
    scope: { ids: ["team-1"] },
    agentDefinition: "context.synthesizer@1",
    operation: "retrieve",
    memoryScope: { agentDefinition: "context.synthesizer@1", projectId: "project-1" },
    query: "project risk patterns",
    maxResults: 5,
  }).valid,
  true,
);
assert.equal(
  validateContract("agentMemoryResult", {
    contractVersion: "agent-memory-result.v1",
    requestId: "memory-1",
    status: "completed",
    memories: [{
      id: "memory-record-1",
      agentDefinition: "context.synthesizer@1",
      summary: "Project investigations often need a QA confirmation.",
      evidenceRefs: ["artifact://memory/evidence-1"],
      observedAt: "2026-08-20T16:00:00Z",
    }],
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowSignal", {
    contractVersion: "workflow-signal.v1",
    signalName: "blueprint-approval",
    signalId: "signal-1",
    payload: { stepId: "summary", approved: true },
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowSignal", {
    contractVersion: "workflow-signal.v1",
    signalName: "workflow-pause",
    signalId: "signal-2",
    payload: { reason: "Operator review" },
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowSignal", {
    contractVersion: "workflow-signal.v1",
    signalName: "workflow-resume",
    signalId: "signal-3",
    payload: {},
  }).valid,
  true,
);
assert.equal(
  validateContract("coordinatorEvent", {
    contractVersion: "coordinator-event.v1",
    eventId: "event-1",
    eventType: "workflow-plan-approved",
    coordinatorId: "coord-1",
    organizationId: "org-1",
    actorId: "user-1",
    planId: "plan-1",
    approved: true,
    blueprintId: "blueprint-1",
    blueprintVersion: "1.0.0",
    workflowStarts: [{ blueprintId: "blueprint-1", blueprintVersion: "1.0.0", key: "project-checkout", businessInput: { projectKey: "checkout" } }],
    scope: { ids: ["project-1"] },
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowUpdate", {
    contractVersion: "workflow-update.v1",
    updateName: "blueprint-context",
    updateId: "update-1",
    payload: { businessInput: { projectKey: "checkout" }, reason: "Project was added to Jira." },
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowChangePlan", {
    contractVersion: "workflow-change-plan.v1",
    planId: "plan-1",
    coordinatorId: "coord-1",
    organizationId: "org-1",
    observedAt: "2026-08-20T16:00:00.000Z",
    changes: [{
      kind: "create",
      blueprint,
      start: { key: "project-checkout", businessInput: { projectKey: "checkout" } },
      reason: "Create the approved project context workflow.",
      requiresApproval: true,
    }],
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowBlueprintLifecycle", {
    contractVersion: "workflow-blueprint-lifecycle.v1",
    action: "create_revision",
    sourceVersion: "1.0.0",
    version: "1.0.1",
    reason: "Publish the reviewed workflow revision.",
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowBlueprintLifecycle", {
    contractVersion: "workflow-blueprint-lifecycle.v1",
    action: "mark_current",
    sourceVersion: "1.0.0",
    reason: "Make the reviewed revision the default for new workflows.",
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowBlueprintLifecycle", {
    action: "deprecate",
    reason: "Missing contract version.",
  }).valid,
  false,
);
assert.equal(
  validateContract("workflowChangePlan", {
    contractVersion: "workflow-change-plan.v1",
    planId: "plan-with-metadata",
    coordinatorId: "coord-1",
    organizationId: "org-1",
    observedAt: "2026-08-20T16:00:00.000Z",
    metadata: {
      planner: { name: "manual-workflow-planner", version: "1.0.0" },
      sourceSchemaVersion: "workflow-template.v1",
      promptVersion: "workflow-creation-input.v1",
      promptHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    changes: [{
      kind: "create",
      blueprint,
      reason: "Create the approved project context workflow.",
      requiresApproval: true,
    }],
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowChangePlan", {
    contractVersion: "workflow-change-plan.v1",
    planId: "plan-2",
    coordinatorId: "coord-1",
    organizationId: "org-1",
    observedAt: "2026-08-20T16:00:00.000Z",
    changes: [
      {
        kind: "update",
        targetBlueprintId: "project-context",
        targetBlueprintVersion: "1.0.0",
        blueprint: { ...blueprint, version: "2.0.0" },
        reason: "Publish a new project context revision.",
        requiresApproval: true,
      },
      {
        kind: "deprecate",
        targetBlueprintId: "project-context",
        targetBlueprintVersion: "0.9.0",
        reason: "Retire the obsolete revision.",
        requiresApproval: true,
      },
      {
        kind: "cancel",
        targetWorkflowId: "workflow:org-1:encois.user-blueprint.v1:project-1",
        reason: "Cancel the superseded execution.",
        requiresApproval: true,
      },
    ],
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowChangePlan", {
    contractVersion: "workflow-change-plan.v1",
    planId: "plan-invalid",
    coordinatorId: "coord-1",
    organizationId: "org-1",
    observedAt: "2026-08-20T16:00:00.000Z",
    changes: [{
      kind: "deprecate",
    targetWorkflowId: "workflow:org-1:encois.user-blueprint.v1:project-1",
      reason: "Wrong target kind.",
      requiresApproval: true,
    }],
  }).valid,
  false,
);
assert.equal(
  validateContract("workflowBlueprint", {
    ...blueprint,
    steps: [{ id: "bad-tool", kind: "tool" }],
  }).valid,
  false,
);
assert.equal(
  validateContract("toolResult", {
    contractVersion: ContractVersion.ToolResult,
    requestId: "tool-1",
    tool: "jira.project_tasks",
    status: "completed",
    evidenceRefs: ["jira://project/checkout"],
    provenance: { source: "jira", sourceRecordId: "checkout", observedAt: "2026-08-20T16:00:00.000Z" },
    confidence: 0.88,
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowResult", {
    contractVersion: ContractVersion.WorkflowResult,
    status: "completed",
    steps: [{ stepId: "collect", status: "completed", confidence: 0.88, trace: { provider: "github", durationMs: 420, attempt: 1, outcome: "completed", redacted: true } }],
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowResult", {
    contractVersion: ContractVersion.WorkflowResult,
    status: "completed",
    steps: [{ stepId: "collect", status: "completed", confidence: 1.01 }],
  }).valid,
  false,
);

console.log("contract schemas ok");
