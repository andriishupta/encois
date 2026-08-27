package workflows

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/agents"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
	contractschemas "github.com/andriishupta/encois/packages/contracts"
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

func TestCreateCoordinatorPlanUsesAssignedIDInExplicitMockMode(t *testing.T) {
	activities := NewActivities(&agents.Bundle{Mode: agents.ModeMock, Enabled: true}, "")
	input := coordinator.CoordinatorStartInput{
		ContractVersion:  coordinator.CoordinatorContractVersion,
		CoordinatorID:    "organization:org-1",
		OrganizationID:   "org-1",
		ScopeType:        coordinator.ScopeOrganization,
		Scope:            coordinator.WorkflowPlanScope{IDs: []string{"unit-1"}},
		PolicyVersion:    "policy-read-only-fixture-v1",
		CoordinationMode: "start-coordinator",
		State: coordinator.CoordinatorState{
			Status:              coordinator.StatusOnboarding,
			OnboardingComplete:  false,
			ReconciliationCount: 1,
		},
	}

	result, err := activities.CreateCoordinatorPlan(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "proposed" || result.Plan == nil {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.Plan.PlanID != coordinatorPlanID(input) {
		t.Fatalf("expected assigned plan id %q, got %q", coordinatorPlanID(input), result.Plan.PlanID)
	}
}

func TestPlanIDIsStableForActivityRetryAndChangesWithCoordinatorState(t *testing.T) {
	input := coordinator.CoordinatorStartInput{
		ContractVersion: coordinator.CoordinatorContractVersion,
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		ScopeType:       coordinator.ScopeOrganization,
		Scope:           coordinator.WorkflowPlanScope{IDs: []string{"unit-1"}},
		PolicyVersion:   "policy-v1",
		State: coordinator.CoordinatorState{
			Version:             1,
			ReconciliationCount: 1,
		},
	}

	first := coordinatorPlanID(input)
	if first == "" || first != coordinatorPlanID(input) {
		t.Fatalf("expected deterministic plan id, got %q", first)
	}
	input.State.Version++
	if first == coordinatorPlanID(input) {
		t.Fatal("expected a new coordinator state version to produce a new plan id")
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

	if err := normalizeWorkflowChangePlan(&plan, workflowPlanAuthority{
		PlanID:         "plan-1",
		CoordinatorID:  "coord-1",
		OrganizationID: "org-1",
		Scope:          &input.Scope,
	}); err != nil {
		t.Fatal(err)
	}
	input.Scope.IDs[0] = "changed-after-normalization"

	if plan.Scope == nil || len(plan.Scope.IDs) != 2 || plan.Scope.IDs[0] != "unit-1" {
		t.Fatalf("expected copied authorized scope, got %+v", plan.Scope)
	}
}

func TestNormalizeWorkflowChangePlanOverwritesModelOwnedMetadata(t *testing.T) {
	plan := coordinator.WorkflowChangePlan{
		ContractVersion: "wrong.v1",
		PlanID:          "model-plan",
		CoordinatorID:   "model-coordinator",
		OrganizationID:  "model-organization",
		ProjectID:       "model-project",
		ObservedAt:      "",
		EvidenceRefs:    []string{"model://evidence"},
		Changes: []coordinator.WorkflowChange{{
			EvidenceRefs: []string{"model://change-evidence"},
			Blueprint:    &coordinator.WorkflowBlueprint{ContractVersion: "wrong-blueprint.v1"},
		}},
	}

	if err := normalizeWorkflowChangePlan(&plan, workflowPlanAuthority{
		PlanID:         "assigned-plan",
		CoordinatorID:  "organization:org-1",
		OrganizationID: "org-1",
		ProjectID:      "project-1",
	}); err != nil {
		t.Fatal(err)
	}
	if plan.ContractVersion != coordinator.WorkflowChangePlanVersion || plan.PlanID != "assigned-plan" || plan.CoordinatorID != "organization:org-1" || plan.OrganizationID != "org-1" || plan.ProjectID != "project-1" {
		t.Fatalf("runtime metadata was not normalized: %+v", plan)
	}
	if _, err := time.Parse(time.RFC3339Nano, plan.ObservedAt); err != nil {
		t.Fatalf("expected runtime observedAt, got %q: %v", plan.ObservedAt, err)
	}
	if plan.EvidenceRefs != nil || plan.Changes[0].EvidenceRefs != nil {
		t.Fatalf("untrusted model evidence references were not removed: %+v", plan)
	}
	if plan.Changes[0].Blueprint.ContractVersion != string(contractschemas.ContractWorkflowBlueprint) {
		t.Fatalf("blueprint contract version was not normalized: %+v", plan.Changes[0].Blueprint)
	}
	if strings.TrimSpace(plan.ObservedAt) == "" {
		t.Fatal("expected non-empty observedAt")
	}
}
