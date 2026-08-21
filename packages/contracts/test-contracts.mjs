import assert from "node:assert/strict";
import { createReleaseInvestigationBlueprint, validateContract } from "./dist/src/index.js";

const request = {
  contractVersion: "release-investigation.v1",
  projectKey: "checkout",
  releaseKey: "aug-30",
};

assert.equal(validateContract("releaseInvestigation", request).valid, true);
assert.equal(validateContract("workflowBlueprint", createReleaseInvestigationBlueprint(request)).valid, true);
assert.equal(
  validateContract("toolManifest", {
    contractVersion: "tool-manifest.v1",
    name: "jira.release_tasks",
    version: "1.0.0",
    kind: "tool",
    description: "Read release task status from Jira.",
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
    workflowId: "workflow:org-1:release-1",
    organizationId: "org-1",
    actorId: "actor-1",
    policyVersion: "policy-read-only-fixture-v1",
    scope: { ids: ["team-1"] },
    objectKey: "evidence/release.json",
    contentType: "application/json",
    dataRef: "provider:jira:release-1",
  }).valid,
  true,
);
assert.equal(
  validateContract("graphQuery", {
    contractVersion: "graph-query.v1",
    requestId: "graph-1",
    workflowId: "workflow:org-1:release-1",
    organizationId: "org-1",
    actorId: "actor-1",
    policyVersion: "policy-read-only-fixture-v1",
    scope: { ids: ["team-1"] },
    query: "release.related_entities",
    params: { releaseKey: "aug-30" },
  }).valid,
  true,
);
assert.equal(
  validateContract("graphQueryResult", {
    contractVersion: "graph-query-result.v1",
    requestId: "graph-1",
    status: "completed",
    nodes: [{ id: "release-1", type: "release", properties: { key: "aug-30" } }],
    edges: [{ id: "edge-1", sourceId: "release-1", targetId: "project-1", relationship: "belongs_to", properties: {} }],
  }).valid,
  true,
);
assert.equal(
  validateContract("agentMemory", {
    contractVersion: "agent-memory.v1",
    requestId: "memory-1",
    workflowId: "workflow:org-1:release-1",
    organizationId: "org-1",
    actorId: "actor-1",
    policyVersion: "policy-read-only-fixture-v1",
    scope: { ids: ["team-1"] },
    agentDefinition: "release-investigation.synthesizer@1",
    operation: "retrieve",
    memoryScope: { agentDefinition: "release-investigation.synthesizer@1", projectId: "project-1" },
    query: "release risk patterns",
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
      agentDefinition: "release-investigation.synthesizer@1",
      summary: "Release investigations often need a QA confirmation.",
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
    payload: { stepId: "release-summary", approved: true },
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
    workflowStarts: [{ blueprintId: "blueprint-1", blueprintVersion: "1.0.0", key: "release-aug-30", businessInput: { releaseKey: "aug-30" } }],
    scope: { ids: ["project-1"] },
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowUpdate", {
    contractVersion: "workflow-update.v1",
    updateName: "blueprint-context",
    updateId: "update-1",
    payload: { businessInput: { releaseKey: "aug-30" }, reason: "Release was added to Jira." },
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
      blueprint: createReleaseInvestigationBlueprint(request),
      start: { key: "release-aug-30", businessInput: { releaseKey: "aug-30" } },
      reason: "Create the approved release readiness workflow.",
      requiresApproval: true,
    }],
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowChangePlanV2", {
    contractVersion: "workflow-change-plan.v2",
    planId: "plan-2",
    coordinatorId: "coord-1",
    organizationId: "org-1",
    observedAt: "2026-08-20T16:00:00.000Z",
    changes: [
      {
        kind: "update",
        targetBlueprintId: "release-readiness",
        targetBlueprintVersion: "1.0.0",
        blueprint: { ...createReleaseInvestigationBlueprint(request), version: "2.0.0" },
        reason: "Publish a new release readiness revision.",
        requiresApproval: true,
      },
      {
        kind: "deprecate",
        targetBlueprintId: "release-readiness",
        targetBlueprintVersion: "0.9.0",
        reason: "Retire the obsolete revision.",
        requiresApproval: true,
      },
      {
        kind: "cancel",
        targetWorkflowId: "workflow:org-1:encois.user-blueprint.v1:release-1",
        reason: "Cancel the superseded execution.",
        requiresApproval: true,
      },
    ],
  }).valid,
  true,
);
assert.equal(
  validateContract("workflowChangePlanV2", {
    contractVersion: "workflow-change-plan.v2",
    planId: "plan-invalid",
    coordinatorId: "coord-1",
    organizationId: "org-1",
    observedAt: "2026-08-20T16:00:00.000Z",
    changes: [{
      kind: "deprecate",
      targetWorkflowId: "workflow:org-1:encois.user-blueprint.v1:release-1",
      reason: "Wrong target kind.",
      requiresApproval: true,
    }],
  }).valid,
  false,
);
assert.equal(
  validateContract("workflowBlueprint", {
    ...createReleaseInvestigationBlueprint(request),
    steps: [{ id: "bad-tool", kind: "tool" }],
  }).valid,
  false,
);

console.log("contract schemas ok");
