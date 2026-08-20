package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/workflow"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
)

const UserBlueprintWorkflowType = "encois.user-blueprint.v1"

type BlueprintWorkflowInput struct {
	Blueprint      coordinator.WorkflowBlueprint `json:"blueprint,omitempty"`
	Payload        coordinator.WorkflowBlueprint `json:"payload,omitempty"`
	RequestID      string                        `json:"requestId"`
	WorkflowID     string                        `json:"workflowId"`
	OrganizationID string                        `json:"organizationId"`
	ActorID        string                        `json:"actorId"`
	PolicyVersion  string                        `json:"policyVersion"`
}

type BlueprintWorkflowResult struct {
	ContractVersion string                `json:"contractVersion"`
	Status          string                `json:"status"`
	Steps           []BlueprintStepResult `json:"steps"`
}

type BlueprintStepResult struct {
	StepID       string         `json:"stepId"`
	Status       string         `json:"status"`
	Data         map[string]any `json:"data,omitempty"`
	EvidenceRefs []string       `json:"evidenceRefs,omitempty"`
}

type BlueprintStepInput struct {
	RequestID      string                   `json:"requestId"`
	WorkflowID     string                   `json:"workflowId"`
	OrganizationID string                   `json:"organizationId"`
	ActorID        string                   `json:"actorId"`
	PolicyVersion  string                   `json:"policyVersion"`
	Step           coordinator.WorkflowStep `json:"step"`
}

// DynamicBlueprintWorkflow is one generic executable for user-created
// blueprints. Temporal still runs registered Go code; the user's workflow is
// data (a validated DAG), not generated Go code.
func DynamicBlueprintWorkflow(ctx workflow.Context, args converter.EncodedValues) (BlueprintWorkflowResult, error) {
	var input BlueprintWorkflowInput
	if err := args.Get(&input); err != nil {
		return BlueprintWorkflowResult{}, fmt.Errorf("decode blueprint workflow input: %w", err)
	}
	blueprint := input.Blueprint
	if blueprint.WorkflowType == "" {
		blueprint = input.Payload
	}
	if blueprint.WorkflowType != UserBlueprintWorkflowType {
		return BlueprintWorkflowResult{}, fmt.Errorf("unsupported blueprint workflow type %q", blueprint.WorkflowType)
	}
	if len(blueprint.Steps) == 0 {
		return BlueprintWorkflowResult{}, fmt.Errorf("blueprint contains no steps")
	}

	activityCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute,
	})
	completed := make(map[string]bool, len(blueprint.Steps))
	results := make([]BlueprintStepResult, 0, len(blueprint.Steps))

	for len(results) < len(blueprint.Steps) {
		ready := make([]coordinator.WorkflowStep, 0)
		for _, step := range input.Blueprint.Steps {
			if completed[step.ID] || !dependenciesCompleted(step, completed) {
				continue
			}
			ready = append(ready, step)
		}
		if len(ready) == 0 {
			return BlueprintWorkflowResult{}, fmt.Errorf("blueprint has an unresolved dependency cycle")
		}

		futures := make([]workflow.Future, 0, len(ready))
		for _, step := range ready {
			futures = append(futures, workflow.ExecuteActivity(activityCtx, "ExecuteBlueprintStep", BlueprintStepInput{
				RequestID:      input.RequestID,
				WorkflowID:     input.WorkflowID,
				OrganizationID: input.OrganizationID,
				ActorID:        input.ActorID,
				PolicyVersion:  input.PolicyVersion,
				Step:           step,
			}))
		}

		for index, future := range futures {
			var result BlueprintStepResult
			if err := future.Get(ctx, &result); err != nil {
				return BlueprintWorkflowResult{}, err
			}
			completed[ready[index].ID] = true
			results = append(results, result)
		}
	}

	return BlueprintWorkflowResult{
		ContractVersion: "blueprint-workflow-result.v1",
		Status:          "completed",
		Steps:           results,
	}, nil
}

func dependenciesCompleted(step coordinator.WorkflowStep, completed map[string]bool) bool {
	for _, dependency := range step.DependsOn {
		if !completed[dependency] {
			return false
		}
	}
	return true
}
