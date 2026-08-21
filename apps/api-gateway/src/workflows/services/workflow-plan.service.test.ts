import { describe, expect, it } from "vitest";
import { validateContract, type WorkflowChangePlan, type WorkflowChangePlanV2 } from "@encois/contracts";
import type { AosPrincipal } from "../../middleware/aos.js";
import { createPlanCoordinatorEvent } from "./workflow-plan.service.js";

const principal: AosPrincipal = {
  actorId: "user-1",
  organizationId: "org-1",
  scope: ["project:checkout"],
};

const plan: WorkflowChangePlan = {
  contractVersion: "workflow-change-plan.v1",
  planId: "plan-1",
  coordinatorId: "coord-1",
  organizationId: "org-1",
  observedAt: "2026-08-20T16:00:00.000Z",
  changes: [
    {
      kind: "create",
      blueprint: {
        contractVersion: "workflow-blueprint.v1",
        blueprintId: "release-readiness",
        version: "1.0.0",
        name: "Release readiness",
        workflowType: "encois.user-blueprint.v1",
        purpose: "Assess release readiness.",
        enabled: true,
        steps: [{ id: "jira", kind: "tool", tool: "jira.project_tasks" }],
      },
      start: { key: "release:checkout:2026-08-30", businessInput: { releaseKey: "2026-08-30" } },
      reason: "Create the approved release workflow.",
      requiresApproval: true,
    },
  ],
};

describe("workflow plan coordinator events", () => {
  it("does not request execution at approval time", () => {
    const event = createPlanCoordinatorEvent(principal, planRecord(plan), "workflow-plan-approved");

    expect(event.workflowStarts).toBeUndefined();
    expect(validateContract("coordinatorEvent", event).valid).toBe(true);
  });

  it("turns only explicit start intents into approved snapshot starts", () => {
    const event = createPlanCoordinatorEvent(principal, planRecord(plan), "workflow-plan-applied");

    expect(event.workflowStarts).toEqual([
      {
        blueprintId: "release-readiness",
        blueprintVersion: "1.0.0",
        key: "release:checkout:2026-08-30",
        businessInput: { releaseKey: "2026-08-30" },
      },
    ]);
    expect(validateContract("coordinatorEvent", event).valid).toBe(true);
  });

  it("does not start a registry-only change", () => {
    const registryOnlyPlan: WorkflowChangePlan = {
      ...plan,
      changes: [
        {
          kind: "create",
          blueprint: plan.changes[0]!.blueprint,
          reason: plan.changes[0]!.reason,
          requiresApproval: plan.changes[0]!.requiresApproval,
        },
      ],
    };
    const event = createPlanCoordinatorEvent(principal, planRecord(registryOnlyPlan), "workflow-plan-applied");

    expect(event.workflowStarts).toBeUndefined();
    expect(validateContract("coordinatorEvent", event).valid).toBe(true);
  });

  it("does not infer a start for a cancel-only execution plan", () => {
    const cancellationPlan: WorkflowChangePlanV2 = {
      contractVersion: "workflow-change-plan.v2",
      planId: "plan-cancel-1",
      coordinatorId: "coord-1",
      organizationId: "org-1",
      observedAt: "2026-08-20T16:00:00.000Z",
      changes: [
        {
          kind: "cancel",
          targetWorkflowId: "workflow:org-1:encois.user-blueprint.v1:release-1",
          reason: "The execution is superseded.",
          requiresApproval: true,
        },
      ],
    };
    const event = createPlanCoordinatorEvent(principal, planRecord(cancellationPlan), "workflow-plan-applied");

    expect(event.workflowStarts).toBeUndefined();
    expect(validateContract("coordinatorEvent", event).valid).toBe(true);
  });
});

function planRecord(value: WorkflowChangePlan | WorkflowChangePlanV2) {
  return {
    planId: value.planId,
    coordinatorId: value.coordinatorId,
    organizationId: value.organizationId,
    plan: value,
  };
}
