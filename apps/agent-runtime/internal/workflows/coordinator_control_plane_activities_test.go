package workflows

import (
	"context"
	"testing"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/integrations/corecoordinator"
)

type fakeCoordinatorClient struct{}

func (fakeCoordinatorClient) SubmitWorkflowChangePlan(context.Context, coordinator.WorkflowChangePlan) (corecoordinator.PlanSubmission, error) {
	return corecoordinator.PlanSubmission{PlanID: "plan-test", Accepted: true, Status: "proposed"}, nil
}

func (fakeCoordinatorClient) StartApprovedWorkflow(context.Context, corecoordinator.StartWorkflowRequest) (corecoordinator.WorkflowReference, error) {
	return corecoordinator.WorkflowReference{WorkflowID: "workflow-test", Status: "queued"}, nil
}

func (fakeCoordinatorClient) UpdateOnboardingStatus(context.Context, coordinator.OnboardingStatusUpdate) error {
	return nil
}

func TestCoordinatorControlPlaneActivitiesDelegateWithoutDatabase(t *testing.T) {
	activities := NewCoordinatorControlPlaneActivities(fakeCoordinatorClient{})
	plan, err := activities.SubmitWorkflowChangePlan(context.Background(), coordinator.WorkflowChangePlan{PlanID: "plan-test"})
	if err != nil || !plan.Accepted {
		t.Fatalf("unexpected plan result: %+v, error: %v", plan, err)
	}

	workflow, err := activities.StartApprovedWorkflow(context.Background(), corecoordinator.StartWorkflowRequest{RequestID: "request-test"})
	if err != nil || workflow.WorkflowID != "workflow-test" {
		t.Fatalf("unexpected workflow result: %+v, error: %v", workflow, err)
	}
}

func TestCoordinatorControlPlaneActivitiesFailClosedWhenUnconfigured(t *testing.T) {
	activities := NewCoordinatorControlPlaneActivities(nil)
	if _, err := activities.SubmitWorkflowChangePlan(context.Background(), coordinator.WorkflowChangePlan{}); err == nil {
		t.Fatal("expected unconfigured control-plane client to fail closed")
	}
	if err := activities.UpdateOnboardingStatus(context.Background(), coordinator.OnboardingStatusUpdate{}); err == nil {
		t.Fatal("expected unconfigured control-plane client to fail closed")
	}
}
