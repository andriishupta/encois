package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/workflow"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
)

const UserBlueprintWorkflowType = coordinator.UserBlueprintWorkflowType

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
	RequestID      string                         `json:"requestId"`
	WorkflowID     string                         `json:"workflowId"`
	OrganizationID string                         `json:"organizationId"`
	ActorID        string                         `json:"actorId"`
	PolicyVersion  string                         `json:"policyVersion"`
	Step           coordinator.WorkflowStep       `json:"step"`
	PriorResults   map[string]BlueprintStepResult `json:"priorResults,omitempty"`
}

type BlueprintApprovalSignal struct {
	StepID   string `json:"stepId"`
	Approved bool   `json:"approved"`
	Reason   string `json:"reason,omitempty"`
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
	stepResults := make(map[string]BlueprintStepResult, len(blueprint.Steps))
	results := make([]BlueprintStepResult, 0, len(blueprint.Steps))
	approvalChannel := workflow.GetSignalChannel(ctx, "blueprint-approval")
	pendingApprovals := make(map[string]BlueprintApprovalSignal)

	for len(results) < len(blueprint.Steps) {
		ready := make([]coordinator.WorkflowStep, 0)
		for _, step := range blueprint.Steps {
			if completed[step.ID] || !dependenciesCompleted(step, completed) {
				continue
			}
			ready = append(ready, step)
		}
		if len(ready) == 0 {
			return BlueprintWorkflowResult{}, fmt.Errorf("blueprint has an unresolved dependency cycle")
		}

		futures := make([]workflow.Future, 0, len(ready))
		futureSteps := make([]coordinator.WorkflowStep, 0, len(ready))
		for _, step := range ready {
			switch step.Kind {
			case "tool", "agent":
				futures = append(futures, workflow.ExecuteActivity(activityCtx, "ExecuteBlueprintStep", BlueprintStepInput{
					RequestID:      input.RequestID,
					WorkflowID:     input.WorkflowID,
					OrganizationID: input.OrganizationID,
					ActorID:        input.ActorID,
					PolicyVersion:  input.PolicyVersion,
					Step:           step,
					PriorResults:   dependencyResults(step, stepResults),
				}))
				futureSteps = append(futureSteps, step)
			case "transform":
				completeStep(step, BlueprintStepResult{StepID: step.ID, Status: "completed", Data: step.Input}, completed, stepResults, &results)
			case "condition":
				condition, ok := step.Input["condition"].(bool)
				if !ok {
					return BlueprintWorkflowResult{}, fmt.Errorf("condition step %q requires boolean input.condition", step.ID)
				}
				status := "completed"
				if !condition {
					status = "skipped"
				}
				completeStep(step, BlueprintStepResult{StepID: step.ID, Status: status, Data: map[string]any{"condition": condition}}, completed, stepResults, &results)
			case "wait":
				durationText, ok := step.Input["duration"].(string)
				if !ok {
					return BlueprintWorkflowResult{}, fmt.Errorf("wait step %q requires string input.duration", step.ID)
				}
				duration, err := time.ParseDuration(durationText)
				if err != nil || duration < 0 {
					return BlueprintWorkflowResult{}, fmt.Errorf("wait step %q has invalid duration %q", step.ID, durationText)
				}
				futures = append(futures, workflow.NewTimer(ctx, duration))
				futureSteps = append(futureSteps, step)
			case "approval":
				approval, ok := pendingApprovals[step.ID]
				for !ok {
					var received BlueprintApprovalSignal
					approvalChannel.Receive(ctx, &received)
					if received.StepID == step.ID {
						approval, ok = received, true
						continue
					}
					pendingApprovals[received.StepID] = received
				}
				delete(pendingApprovals, step.ID)
				if !approval.Approved {
					return BlueprintWorkflowResult{}, fmt.Errorf("approval denied for step %q: %s", step.ID, approval.Reason)
				}
				completeStep(step, BlueprintStepResult{StepID: step.ID, Status: "approved"}, completed, stepResults, &results)
			default:
				return BlueprintWorkflowResult{}, fmt.Errorf("unsupported blueprint step kind %q", step.Kind)
			}
		}

		for index, future := range futures {
			var result BlueprintStepResult
			if err := future.Get(ctx, &result); err != nil {
				return BlueprintWorkflowResult{}, err
			}
			if result.StepID == "" {
				result.StepID = futureSteps[index].ID
			}
			if result.Status == "" {
				result.Status = "completed"
			}
			completeStep(futureSteps[index], result, completed, stepResults, &results)
		}
	}

	return BlueprintWorkflowResult{
		ContractVersion: "blueprint-workflow-result.v1",
		Status:          "completed",
		Steps:           results,
	}, nil
}

func completeStep(step coordinator.WorkflowStep, result BlueprintStepResult, completed map[string]bool, stepResults map[string]BlueprintStepResult, results *[]BlueprintStepResult) {
	completed[step.ID] = true
	stepResults[step.ID] = result
	*results = append(*results, result)
}

func dependencyResults(step coordinator.WorkflowStep, all map[string]BlueprintStepResult) map[string]BlueprintStepResult {
	if len(step.DependsOn) == 0 {
		return nil
	}
	results := make(map[string]BlueprintStepResult, len(step.DependsOn))
	for _, dependency := range step.DependsOn {
		if result, ok := all[dependency]; ok {
			results[dependency] = result
		}
	}
	return results
}

func dependenciesCompleted(step coordinator.WorkflowStep, completed map[string]bool) bool {
	for _, dependency := range step.DependsOn {
		if !completed[dependency] {
			return false
		}
	}
	return true
}
