package workflows

import (
	"context"
	"testing"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
)

func TestDynamicBlueprintWorkflowExecutesGenericToolAndAgentSteps(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterDynamicWorkflow(DynamicBlueprintWorkflow, workflow.DynamicRegisterOptions{})
	registerContractActivities(env)
	env.RegisterActivityWithOptions(testBlueprintActivity, activity.RegisterOptions{Name: "ExecuteBlueprintStep"})

	env.ExecuteWorkflow(UserBlueprintWorkflowType, BlueprintWorkflowInput{
		ContractVersion: "workflow-blueprint.v1",
		WorkflowID:      "workflow:org-1:release-1",
		OrganizationID:  "org-1",
		ActorID:         "user-1",
		RequestID:       "request-1",
		PolicyVersion:   "policy-read-only-fixture-v1",
		Scope:           map[string]any{"ids": []any{"team-a"}},
		BusinessInput:   map[string]any{"releaseKey": "aug-30"},
		Blueprint: coordinator.WorkflowBlueprint{
			ContractVersion: "workflow-blueprint.v1",
			BlueprintID:     "release-investigation:aug-30",
			Version:         "1.0.0",
			Name:            "Release investigation",
			WorkflowType:    UserBlueprintWorkflowType,
			Purpose:         "Check release readiness",
			Steps: []coordinator.WorkflowStep{
				{ID: "jira", Kind: "tool", Tool: "jira.release_tasks"},
				{ID: "github", Kind: "tool", Tool: "github.release_activity"},
				{ID: "synthesis", Kind: "agent", AgentDefinition: "release-investigation.synthesizer@1", DependsOn: []string{"jira", "github"}},
			},
		},
	})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
	var result BlueprintWorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" || len(result.Steps) != 3 {
		t.Fatalf("unexpected workflow result: %+v", result)
	}
	for _, step := range result.Steps {
		if step.Status != "completed" {
			t.Fatalf("step %q has status %q", step.StepID, step.Status)
		}
	}
}

func TestDynamicBlueprintWorkflowDeduplicatesApprovalSignals(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterDynamicWorkflow(DynamicBlueprintWorkflow, workflow.DynamicRegisterOptions{})
	registerContractActivities(env)
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow("blueprint-approval", BlueprintApprovalSignal{SignalID: "approval-1", StepID: "approval", Approved: true})
		env.SignalWorkflow("blueprint-approval", BlueprintApprovalSignal{SignalID: "approval-1", StepID: "approval", Approved: false, Reason: "duplicate"})
	}, time.Second)

	env.ExecuteWorkflow(UserBlueprintWorkflowType, BlueprintWorkflowInput{
		ContractVersion: "workflow-blueprint.v1",
		WorkflowID:      "workflow:org-1:approval-1",
		OrganizationID:  "org-1",
		ActorID:         "user-1",
		RequestID:       "request-approval-1",
		PolicyVersion:   "policy-read-only-fixture-v1",
		Scope:           map[string]any{"ids": []any{"team-a"}},
		Blueprint: coordinator.WorkflowBlueprint{
			ContractVersion: "workflow-blueprint.v1",
			BlueprintID:     "approval-check",
			Version:         "1.0.0",
			Name:            "Approval check",
			WorkflowType:    UserBlueprintWorkflowType,
			Purpose:         "Require approval",
			Steps:           []coordinator.WorkflowStep{{ID: "approval", Kind: "approval"}},
		},
	})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
	var result BlueprintWorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" || len(result.Steps) != 1 || result.Steps[0].Status != "approved" {
		t.Fatalf("unexpected approval result: %+v", result)
	}
}

func TestDynamicBlueprintWorkflowRejectsInvalidContract(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterDynamicWorkflow(DynamicBlueprintWorkflow, workflow.DynamicRegisterOptions{})
	registerContractActivities(env)
	env.ExecuteWorkflow(UserBlueprintWorkflowType, BlueprintWorkflowInput{
		ContractVersion: "workflow-blueprint.v0",
		WorkflowID:      "workflow:org-1:invalid",
		OrganizationID:  "org-1",
		ActorID:         "user-1",
		RequestID:       "request-invalid",
		PolicyVersion:   "policy-read-only-fixture-v1",
		Scope:           map[string]any{"ids": []any{"team-a"}},
	})

	if err := env.GetWorkflowError(); err == nil {
		t.Fatal("expected invalid contract error")
	}
}

func TestDynamicBlueprintWorkflowRejectsEmptyScope(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterDynamicWorkflow(DynamicBlueprintWorkflow, workflow.DynamicRegisterOptions{})
	registerContractActivities(env)
	env.ExecuteWorkflow(UserBlueprintWorkflowType, BlueprintWorkflowInput{
		ContractVersion: "workflow-blueprint.v1",
		WorkflowID:      "workflow:org-1:empty-scope",
		OrganizationID:  "org-1",
		ActorID:         "user-1",
		RequestID:       "request-empty-scope",
		PolicyVersion:   "policy-read-only-fixture-v1",
		Scope:           map[string]any{"ids": []any{}},
		Blueprint: coordinator.WorkflowBlueprint{
			ContractVersion: "workflow-blueprint.v1",
			BlueprintID:     "scope-check",
			Version:         "1.0.0",
			Name:            "Scope check",
			WorkflowType:    UserBlueprintWorkflowType,
			Purpose:         "Require a scope",
			Steps:           []coordinator.WorkflowStep{{ID: "transform", Kind: "transform"}},
		},
	})

	if err := env.GetWorkflowError(); err == nil {
		t.Fatal("expected empty scope error")
	}
}

func testBlueprintActivity(_ context.Context, input BlueprintStepInput) (BlueprintStepResult, error) {
	return BlueprintStepResult{
		StepID: input.Step.ID,
		Status: "completed",
		Data:   map[string]any{"tool": input.Step.Tool, "agentDefinition": input.Step.AgentDefinition},
	}, nil
}

func registerContractActivities(env *testsuite.TestWorkflowEnvironment) {
	env.RegisterActivityWithOptions(ValidateBlueprintContract, activity.RegisterOptions{Name: "ValidateBlueprintContract"})
	env.RegisterActivityWithOptions(ValidateBlueprintResult, activity.RegisterOptions{Name: "ValidateBlueprintResult"})
}
