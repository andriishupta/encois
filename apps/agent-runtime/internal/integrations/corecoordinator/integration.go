package corecoordinator

import (
	"context"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
)

// Client is the narrow control-plane boundary used by Coordinator Activities.
// Implementations call the Gateway API; they must not connect to its database.
type Client interface {
	SubmitWorkflowChangePlan(context.Context, coordinator.WorkflowChangePlan) (PlanSubmission, error)
	CreateWorkflow(context.Context, coordinator.WorkflowBlueprint) (WorkflowReference, error)
	UpdateWorkflow(context.Context, string, coordinator.WorkflowBlueprint) (WorkflowReference, error)
	PauseWorkflow(context.Context, string, string) error
	CancelWorkflow(context.Context, string, string) error
	DeprecateWorkflow(context.Context, string, string) error
}

type PlanSubmission struct {
	PlanID           string   `json:"planId"`
	Accepted         bool     `json:"accepted"`
	RequiresApproval bool     `json:"requiresApproval"`
	WorkflowIDs      []string `json:"workflowIds,omitempty"`
}

type WorkflowReference struct {
	WorkflowID string `json:"workflowId"`
	RunID      string `json:"runId,omitempty"`
	Status     string `json:"status"`
}
