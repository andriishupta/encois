package coordinator

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
)

func TestBootstrapProjectWorkflowDefersWhenCreatorIsUnavailable(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflow(BootstrapProjectWorkflow)
	env.RegisterActivityWithOptions(func(context.Context, BootstrapProjectInput) (BootstrapPlanActivityResult, error) {
		return BootstrapPlanActivityResult{Status: "deferred-no-agent-model"}, nil
	}, activity.RegisterOptions{Name: "CreateBootstrapPlan"})

	env.ExecuteWorkflow(BootstrapProjectWorkflow, BootstrapProjectInput{
		ContractVersion: CoordinatorContractVersion,
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		ProjectID:       "project-1",
		PolicyVersion:   "policy-read-only-fixture-v1",
	})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
	var result BootstrapProjectResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatal(err)
	}
	if result.Ready || result.ContractVersion != "bootstrap-project.v1" {
		t.Fatalf("unexpected bootstrap result: %+v", result)
	}
}

func TestCoordinatorWorkflowSubmitsAPlanAfterReconciliationSignal(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflow(CoordinatorWorkflow)

	submitted := false
	env.RegisterActivityWithOptions(func(context.Context, CoordinatorStartInput) (CoordinatorPlanActivityResult, error) {
		return CoordinatorPlanActivityResult{
			Status: "proposed",
			Plan: &WorkflowChangePlan{
				ContractVersion: WorkflowChangePlanVersion,
				PlanID:          "plan-reconcile-1",
				CoordinatorID:   "coord-1",
				OrganizationID:  "org-1",
				ObservedAt:      "2026-08-20T16:00:00.000Z",
				Changes: []WorkflowChange{{
					Kind:             ChangeCreate,
					Reason:           "enable the approved generic workflow",
					RequiresApproval: true,
					Blueprint: &WorkflowBlueprint{
						ContractVersion:  "workflow-blueprint.v1",
						BlueprintID:      "blueprint-1",
						Version:          "1",
						Name:             "generic context refresh",
						WorkflowType:     DynamicWorkflowType,
						Purpose:          "refresh context",
						Enabled:          true,
						RequiresApproval: true,
					},
				}},
			},
		}, nil
	}, activity.RegisterOptions{Name: CoordinatorPlanActivityName})
	env.RegisterActivityWithOptions(func(context.Context, WorkflowChangePlan) (PlanSubmissionResult, error) {
		submitted = true
		return PlanSubmissionResult{PlanID: "plan-reconcile-1", Accepted: true, Status: "proposed", RequiresApproval: true}, nil
	}, activity.RegisterOptions{Name: CoordinatorSubmitActivityName})

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalReconcile, CoordinatorSignal{ContractVersion: CoordinatorContractVersion, EventID: "event-1"})
	}, time.Second)
	env.RegisterDelayedCallback(func() {
		env.CancelWorkflow()
	}, 2*time.Second)

	env.ExecuteWorkflow(CoordinatorWorkflow, CoordinatorStartInput{
		ContractVersion: CoordinatorContractVersion,
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		ProjectID:       "project-1",
		ScopeType:       ScopeProject,
		PolicyVersion:   "policy-read-only-fixture-v1",
		State:           CoordinatorState{Status: StatusReady},
	})

	if !submitted {
		t.Fatal("expected reconciliation to submit the proposed plan")
	}
}

func TestCoordinatorWorkflowPerformsInitialOnboardingReconciliation(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflow(CoordinatorWorkflow)

	planCalls := 0
	statusUpdates := 0
	env.RegisterActivityWithOptions(func(context.Context, CoordinatorStartInput) (CoordinatorPlanActivityResult, error) {
		planCalls++
		return CoordinatorPlanActivityResult{
			Status: "proposed",
			Plan: &WorkflowChangePlan{
				ContractVersion: WorkflowChangePlanVersion,
				PlanID:          "plan-onboarding-1",
				CoordinatorID:   "coord-1",
				OrganizationID:  "org-1",
				ObservedAt:      "2026-08-20T16:00:00.000Z",
			},
		}, nil
	}, activity.RegisterOptions{Name: CoordinatorPlanActivityName})
	env.RegisterActivityWithOptions(func(context.Context, WorkflowChangePlan) (PlanSubmissionResult, error) {
		return PlanSubmissionResult{PlanID: "plan-onboarding-1", Accepted: true, Status: "proposed"}, nil
	}, activity.RegisterOptions{Name: CoordinatorSubmitActivityName})
	env.RegisterActivityWithOptions(func(context.Context, OnboardingStatusUpdate) error {
		statusUpdates++
		return nil
	}, activity.RegisterOptions{Name: CoordinatorOnboardingStatusActivityName})
	env.RegisterDelayedCallback(func() { env.CancelWorkflow() }, time.Second)

	env.ExecuteWorkflow(CoordinatorWorkflow, CoordinatorStartInput{
		ContractVersion: CoordinatorContractVersion,
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		PolicyVersion:   "policy-read-only-fixture-v1",
		State:           CoordinatorState{Status: StatusOnboarding},
	})

	if planCalls != 1 {
		t.Fatalf("expected initial reconciliation to run immediately, got %d plan calls", planCalls)
	}
	if statusUpdates != 1 {
		t.Fatalf("expected initial reconciliation to report readiness once, got %d updates", statusUpdates)
	}
}

func TestCoordinatorWorkflowFailsOnboardingWhenBootstrapIsDeferred(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflow(CoordinatorWorkflow)

	var update OnboardingStatusUpdate
	env.RegisterActivityWithOptions(func(context.Context, CoordinatorStartInput) (CoordinatorPlanActivityResult, error) {
		return CoordinatorPlanActivityResult{Status: "deferred-no-agent-model"}, nil
	}, activity.RegisterOptions{Name: CoordinatorPlanActivityName})
	env.RegisterActivityWithOptions(func(_ context.Context, received OnboardingStatusUpdate) error {
		update = received
		return nil
	}, activity.RegisterOptions{Name: CoordinatorOnboardingStatusActivityName})
	env.RegisterDelayedCallback(func() { env.CancelWorkflow() }, time.Second)

	env.ExecuteWorkflow(CoordinatorWorkflow, CoordinatorStartInput{
		ContractVersion: CoordinatorContractVersion,
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		PolicyVersion:   "policy-read-only-fixture-v1",
		State:           CoordinatorState{Status: StatusOnboarding},
	})

	if update.Status != "failed" || update.LastError == "" {
		t.Fatalf("expected deferred bootstrap failure status, got %+v", update)
	}
}

func TestCoordinatorWorkflowDeduplicatesCoordinatorEvents(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflow(CoordinatorWorkflow)

	plannedCalls := 0
	startedCalls := 0
	env.RegisterActivityWithOptions(func(context.Context, CoordinatorStartInput) (CoordinatorPlanActivityResult, error) {
		plannedCalls++
		return CoordinatorPlanActivityResult{Status: "deferred-no-agent-model"}, nil
	}, activity.RegisterOptions{Name: CoordinatorPlanActivityName})
	env.RegisterActivityWithOptions(func(context.Context, ApprovedWorkflowStartInput) (ApprovedWorkflowStartResult, error) {
		startedCalls++
		return ApprovedWorkflowStartResult{WorkflowID: "workflow:org-1:encois.dynamic.v1:release-aug-30", Status: "queued"}, nil
	}, activity.RegisterOptions{Name: CoordinatorStartActivityName})
	event := CoordinatorEvent{
		ContractVersion: "coordinator-event.v1",
		EventID:         "event-duplicate",
		EventType:       "workflow-plan-applied",
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		PlanID:          "plan-1",
		WorkflowStarts: []WorkflowStartSpec{{
			BlueprintID:      "release-readiness",
			BlueprintVersion: "1.0.0",
			Key:              "release-aug-30",
			BusinessInput:    map[string]any{"releaseKey": "aug-30"},
			Scope:            map[string]any{"ids": []any{"unit-1"}},
		}},
	}
	wrongOrganization := event
	wrongOrganization.OrganizationID = "org-other"
	env.RegisterDelayedCallback(func() { env.SignalWorkflow(SignalCoordinatorEvent, wrongOrganization) }, time.Second)
	env.RegisterDelayedCallback(func() { env.SignalWorkflow(SignalCoordinatorEvent, event) }, 1100*time.Millisecond)
	env.RegisterDelayedCallback(func() { env.SignalWorkflow(SignalCoordinatorEvent, event) }, 1200*time.Millisecond)
	env.RegisterDelayedCallback(func() { env.CancelWorkflow() }, 2*time.Second)

	env.ExecuteWorkflow(CoordinatorWorkflow, CoordinatorStartInput{
		ContractVersion: CoordinatorContractVersion,
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		PolicyVersion:   "policy-read-only-fixture-v1",
		State:           CoordinatorState{Status: StatusReady},
	})

	if plannedCalls != 1 {
		t.Fatalf("expected duplicate event to trigger one plan attempt, got %d calls", plannedCalls)
	}
	if startedCalls != 1 {
		t.Fatalf("expected duplicate applied event to trigger one workflow start, got %d calls", startedCalls)
	}
}

func TestCoordinatorWorkflowRetainsFailedStartsForRetry(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflow(CoordinatorWorkflow)

	startAllowed := false
	startedCalls := 0
	env.RegisterActivityWithOptions(func(context.Context, ApprovedWorkflowStartInput) (ApprovedWorkflowStartResult, error) {
		if !startAllowed {
			return ApprovedWorkflowStartResult{}, errors.New("gateway temporarily unavailable")
		}
		startedCalls++
		return ApprovedWorkflowStartResult{WorkflowID: "workflow:org-1:encois.dynamic.v1:release-retry", Status: "queued"}, nil
	}, activity.RegisterOptions{Name: CoordinatorStartActivityName})
	env.RegisterActivityWithOptions(func(context.Context, CoordinatorStartInput) (CoordinatorPlanActivityResult, error) {
		return CoordinatorPlanActivityResult{Status: "deferred-no-agent-model"}, nil
	}, activity.RegisterOptions{Name: CoordinatorPlanActivityName})

	event := CoordinatorEvent{
		ContractVersion: "coordinator-event.v1",
		EventID:         "event-retry",
		EventType:       "workflow-plan-applied",
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		PlanID:          "plan-retry",
		WorkflowStarts: []WorkflowStartSpec{{
			BlueprintID:      "release-readiness",
			BlueprintVersion: "1.0.0",
			Key:              "release-retry",
			Scope:            map[string]any{"ids": []any{"unit-1"}},
		}},
	}
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalCoordinatorEvent, event)
	}, time.Second)
	env.RegisterDelayedCallback(func() {
		startAllowed = true
		env.SignalWorkflow(SignalReconcile, CoordinatorSignal{ContractVersion: CoordinatorContractVersion, EventID: "retry-reconcile"})
	}, 4*time.Second)
	env.RegisterDelayedCallback(func() {
		env.CancelWorkflow()
	}, 6*time.Second)

	env.ExecuteWorkflow(CoordinatorWorkflow, CoordinatorStartInput{
		ContractVersion: CoordinatorContractVersion,
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		PolicyVersion:   "policy-read-only-fixture-v1",
		State:           CoordinatorState{Status: StatusReady},
	})

	if startedCalls != 1 {
		t.Fatalf("expected the pending workflow start to succeed after retry signal, got %d calls", startedCalls)
	}
}
