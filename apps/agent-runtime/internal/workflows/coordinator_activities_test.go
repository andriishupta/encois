package workflows

import (
	"context"
	"testing"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/agents"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
)

func TestCreateBootstrapPlanIsExplicitlyDeferredWithoutModel(t *testing.T) {
	activities := NewActivities(&agents.Bundle{}, "")
	result, err := activities.CreateBootstrapPlan(context.Background(), coordinator.BootstrapProjectInput{
		ContractVersion: coordinator.BootstrapProjectContractVersion,
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		ProjectID:       "project-1",
		PolicyVersion:   "policy-read-only-fixture-v1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "deferred-no-agent-model" || result.Plan != nil {
		t.Fatalf("unexpected deferred result: %+v", result)
	}
}

func TestDecodeWorkflowChangePlanAcceptsJsonCodeFence(t *testing.T) {
	plan, err := decodeWorkflowChangePlan("```json\n{\"contractVersion\":\"workflow-change-plan.v1\",\"planId\":\"plan-1\",\"coordinatorId\":\"coord-1\",\"organizationId\":\"org-1\",\"observedAt\":\"2026-08-20T16:00:00.000Z\",\"changes\":[]}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if plan.PlanID != "plan-1" || plan.ContractVersion != coordinator.WorkflowChangePlanVersion {
		t.Fatalf("unexpected plan: %+v", plan)
	}
}

func TestApplyAuthorizedCoordinatorScopeCopiesInputScope(t *testing.T) {
	plan := coordinator.WorkflowChangePlan{
		ContractVersion: coordinator.WorkflowChangePlanVersion,
		PlanID:          "plan-1",
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
	}
	input := coordinator.CoordinatorStartInput{
		Scope: coordinator.WorkflowPlanScope{IDs: []string{"unit-1", "unit-2"}},
	}

	if err := applyAuthorizedCoordinatorScope(&plan, input.Scope); err != nil {
		t.Fatal(err)
	}
	input.Scope.IDs[0] = "changed-after-normalization"

	if plan.Scope == nil || len(plan.Scope.IDs) != 2 || plan.Scope.IDs[0] != "unit-1" {
		t.Fatalf("expected copied authorized scope, got %+v", plan.Scope)
	}
}
