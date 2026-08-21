package workflows

import (
	"context"
	"fmt"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/integrations/corecoordinator"
)

// CoordinatorControlPlaneActivities are the only Runtime Activities allowed
// to call the Gateway control plane. They carry validated, stateless payloads
// and never open a database connection.
type CoordinatorControlPlaneActivities struct {
	client corecoordinator.Client
}

func NewCoordinatorControlPlaneActivities(client corecoordinator.Client) *CoordinatorControlPlaneActivities {
	return &CoordinatorControlPlaneActivities{client: client}
}

func (a *CoordinatorControlPlaneActivities) SubmitWorkflowChangePlan(ctx context.Context, plan coordinator.WorkflowChangePlan) (corecoordinator.PlanSubmission, error) {
	if a == nil || a.client == nil {
		return corecoordinator.PlanSubmission{}, fmt.Errorf("Coordinator control-plane client is not configured")
	}
	return a.client.SubmitWorkflowChangePlan(ctx, plan)
}

func (a *CoordinatorControlPlaneActivities) StartApprovedWorkflow(ctx context.Context, request corecoordinator.StartWorkflowRequest) (corecoordinator.WorkflowReference, error) {
	if a == nil || a.client == nil {
		return corecoordinator.WorkflowReference{}, fmt.Errorf("Coordinator control-plane client is not configured")
	}
	return a.client.StartApprovedWorkflow(ctx, request)
}
