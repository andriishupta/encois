package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
	contracts "github.com/andriishupta/encois/packages/contracts"
)

type BlueprintWorkflowInput struct {
	ContractVersion string                        `json:"contractVersion"`
	Blueprint       coordinator.WorkflowBlueprint `json:"blueprint,omitempty"`
	Payload         coordinator.WorkflowBlueprint `json:"payload,omitempty"`
	RequestID       string                        `json:"requestId"`
	TraceID         string                        `json:"traceId,omitempty"`
	WorkflowID      string                        `json:"workflowId"`
	OrganizationID  string                        `json:"organizationId"`
	ActorID         string                        `json:"actorId"`
	PolicyVersion   string                        `json:"policyVersion"`
	Scope           map[string]any                `json:"scope"`
	Capability      string                        `json:"capability"`
	BusinessInput   map[string]any                `json:"businessInput"`
	IdempotencyKey  string                        `json:"idempotencyKey,omitempty"`
}

type BlueprintWorkflowResult struct {
	ContractVersion string                         `json:"contractVersion"`
	Status          contracts.WorkflowResultStatus `json:"status"`
	StatusReason    contracts.WorkflowStatusReason `json:"statusReason,omitempty"`
	Steps           []BlueprintStepResult          `json:"steps"`
}

type BlueprintStepResult struct {
	StepID       string                         `json:"stepId"`
	Status       string                         `json:"status"`
	StatusReason contracts.WorkflowStatusReason `json:"statusReason,omitempty"`
	Data         map[string]any                 `json:"data,omitempty"`
	EvidenceRefs []string                       `json:"evidenceRefs,omitempty"`
	Provenance   *contracts.DataProvenance      `json:"provenance,omitempty"`
	Confidence   *float64                       `json:"confidence,omitempty"`
	Trace        *contracts.WorkflowTrace       `json:"trace,omitempty"`
	Freshness    []contracts.SourceFreshness    `json:"freshness,omitempty"`
}

type BlueprintStepInput struct {
	RequestID      string                         `json:"requestId"`
	TraceID        string                         `json:"traceId,omitempty"`
	WorkflowID     string                         `json:"workflowId"`
	RunID          string                         `json:"runId"`
	OrganizationID string                         `json:"organizationId"`
	ActorID        string                         `json:"actorId"`
	PolicyVersion  string                         `json:"policyVersion"`
	Scope          map[string]any                 `json:"scope"`
	Capability     string                         `json:"capability"`
	BusinessInput  map[string]any                 `json:"businessInput"`
	Step           coordinator.WorkflowStep       `json:"step"`
	PriorResults   map[string]BlueprintStepResult `json:"priorResults,omitempty"`
}

type BlueprintApprovalSignal struct {
	SignalID string `json:"signalId"`
	StepID   string `json:"stepId"`
	Approved bool   `json:"approved"`
	Reason   string `json:"reason,omitempty"`
}

type BlueprintControlSignal struct {
	SignalID string `json:"signalId"`
	Action   string `json:"action"`
	Reason   string `json:"reason,omitempty"`
}

type BlueprintContextUpdate struct {
	UpdateID      string         `json:"updateId"`
	BusinessInput map[string]any `json:"businessInput"`
	Reason        string         `json:"reason,omitempty"`
}

type BlueprintContextUpdateResult struct {
	UpdateID string `json:"updateId"`
	Accepted bool   `json:"accepted"`
}

// DynamicBlueprintWorkflow is one generic executable for user-created
// blueprints. Temporal still runs registered Go code; the user's workflow is
// data (a validated DAG), not generated Go code.
func DynamicBlueprintWorkflow(ctx workflow.Context, args converter.EncodedValues) (BlueprintWorkflowResult, error) {
	var input BlueprintWorkflowInput
	if err := args.Get(&input); err != nil {
		return BlueprintWorkflowResult{}, fmt.Errorf("decode blueprint workflow input: %w", err)
	}
	if err := validateBlueprintWorkflowInput(input); err != nil {
		return BlueprintWorkflowResult{}, err
	}
	blueprint := input.Blueprint
	if blueprint.WorkflowType == "" {
		blueprint = input.Payload
	}
	if blueprint.WorkflowType != string(contracts.WorkflowTypeDynamic) {
		return BlueprintWorkflowResult{}, fmt.Errorf("unsupported dynamic workflow type %q", blueprint.WorkflowType)
	}
	if len(blueprint.Steps) == 0 {
		return BlueprintWorkflowResult{}, fmt.Errorf("blueprint contains no steps")
	}

	activityCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2,
			MaximumAttempts:    3,
		},
	})
	if err := workflow.ExecuteActivity(activityCtx, "ValidateBlueprintContract", input).Get(ctx, nil); err != nil {
		return BlueprintWorkflowResult{}, err
	}
	completed := make(map[string]bool, len(blueprint.Steps))
	stepResults := make(map[string]BlueprintStepResult, len(blueprint.Steps))
	results := make([]BlueprintStepResult, 0, len(blueprint.Steps))
	businessInput := cloneMap(input.BusinessInput)
	processedUpdateIDs := make(map[string]bool)
	if err := workflow.SetUpdateHandler(ctx, string(contracts.UpdateBlueprintContext), func(_ workflow.Context, update BlueprintContextUpdate) (BlueprintContextUpdateResult, error) {
		if update.UpdateID == "" {
			return BlueprintContextUpdateResult{}, fmt.Errorf("updateId is required")
		}
		if len(update.BusinessInput) == 0 {
			return BlueprintContextUpdateResult{}, fmt.Errorf("businessInput must not be empty")
		}
		if processedUpdateIDs[update.UpdateID] {
			return BlueprintContextUpdateResult{UpdateID: update.UpdateID, Accepted: true}, nil
		}
		for key, value := range update.BusinessInput {
			businessInput[key] = value
		}
		processedUpdateIDs[update.UpdateID] = true
		return BlueprintContextUpdateResult{UpdateID: update.UpdateID, Accepted: true}, nil
	}); err != nil {
		return BlueprintWorkflowResult{}, fmt.Errorf("register blueprint context update: %w", err)
	}
	approvalChannel := workflow.GetSignalChannel(ctx, string(contracts.SignalBlueprintApproval))
	controlChannel := workflow.GetSignalChannel(ctx, string(contracts.SignalWorkflowControl))
	pendingApprovals := make(map[string]BlueprintApprovalSignal)
	processedSignalIDs := make(map[string]bool)
	paused := false
	runID := workflow.GetInfo(ctx).WorkflowExecution.RunID

	for len(results) < len(blueprint.Steps) {
		drainBlueprintControlSignals(controlChannel, &paused, processedSignalIDs)
		waitForBlueprintResume(ctx, controlChannel, &paused, processedSignalIDs)
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
					TraceID:        input.TraceID,
					WorkflowID:     input.WorkflowID,
					RunID:          runID,
					OrganizationID: input.OrganizationID,
					ActorID:        input.ActorID,
					PolicyVersion:  input.PolicyVersion,
					Scope:          input.Scope,
					Capability:     input.Capability,
					BusinessInput:  businessInput,
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
					waitForBlueprintResume(ctx, controlChannel, &paused, processedSignalIDs)
					var received BlueprintApprovalSignal
					var control BlueprintControlSignal
					controlReceived := false
					selector := workflow.NewSelector(ctx)
					selector.AddReceive(approvalChannel, func(channel workflow.ReceiveChannel, _ bool) {
						channel.Receive(ctx, &received)
					})
					selector.AddReceive(controlChannel, func(channel workflow.ReceiveChannel, _ bool) {
						channel.Receive(ctx, &control)
						controlReceived = true
					})
					selector.Select(ctx)
					if controlReceived {
						applyBlueprintControlSignal(control, &paused, processedSignalIDs)
						continue
					}
					if received.SignalID == "" || received.StepID == "" || processedSignalIDs[received.SignalID] {
						continue
					}
					processedSignalIDs[received.SignalID] = true
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

	resultStatus := contracts.WorkflowResultCompleted
	var resultReason contracts.WorkflowStatusReason
	for _, stepResult := range results {
		if stepResult.Status == string(contracts.WorkflowResultWaiting) {
			resultStatus = contracts.WorkflowResultWaiting
			if stepResult.StatusReason != "" {
				resultReason = stepResult.StatusReason
			}
		}
	}
	result := BlueprintWorkflowResult{
		ContractVersion: string(contracts.ContractWorkflowResult),
		Status:          resultStatus,
		StatusReason:    resultReason,
		Steps:           results,
	}
	if err := workflow.ExecuteActivity(activityCtx, "ValidateBlueprintResult", result).Get(ctx, nil); err != nil {
		return BlueprintWorkflowResult{}, err
	}
	return result, nil
}

func applyBlueprintControlSignal(signal BlueprintControlSignal, paused *bool, processed map[string]bool) {
	if signal.SignalID == "" || processed[signal.SignalID] {
		return
	}
	processed[signal.SignalID] = true
	switch signal.Action {
	case string(contracts.SignalWorkflowPause):
		*paused = true
	case string(contracts.SignalWorkflowResume):
		*paused = false
	}
}

func drainBlueprintControlSignals(channel workflow.ReceiveChannel, paused *bool, processed map[string]bool) {
	for {
		var signal BlueprintControlSignal
		if !channel.ReceiveAsync(&signal) {
			return
		}
		applyBlueprintControlSignal(signal, paused, processed)
	}
}

func waitForBlueprintResume(ctx workflow.Context, channel workflow.ReceiveChannel, paused *bool, processed map[string]bool) {
	for *paused {
		var signal BlueprintControlSignal
		channel.Receive(ctx, &signal)
		applyBlueprintControlSignal(signal, paused, processed)
	}
}

func validateBlueprintWorkflowInput(input BlueprintWorkflowInput) error {
	if input.ContractVersion != string(contracts.ContractWorkflowBlueprint) {
		return fmt.Errorf("unsupported workflow contractVersion %q", input.ContractVersion)
	}
	if input.RequestID == "" || input.WorkflowID == "" || input.OrganizationID == "" || input.ActorID == "" || input.PolicyVersion == "" || input.Capability == "" {
		return fmt.Errorf("workflow execution context is incomplete")
	}
	if !workflowIDBelongsToOrganization(input.WorkflowID, input.OrganizationID) {
		return fmt.Errorf("workflow id is outside the organization scope")
	}
	if err := validateScope(input.Scope); err != nil {
		return err
	}
	blueprint := input.Blueprint
	if blueprint.WorkflowType == "" {
		blueprint = input.Payload
	}
	if blueprint.ContractVersion != string(contracts.ContractWorkflowBlueprint) {
		return fmt.Errorf("unsupported blueprint contractVersion %q", blueprint.ContractVersion)
	}
	if blueprint.WorkflowType != string(contracts.WorkflowTypeDynamic) {
		return fmt.Errorf("unsupported dynamic workflow type %q", blueprint.WorkflowType)
	}
	if blueprint.BlueprintID == "" || blueprint.Version == "" || blueprint.Name == "" || blueprint.Purpose == "" {
		return fmt.Errorf("blueprint identity and purpose are required")
	}
	if len(blueprint.Steps) == 0 {
		return fmt.Errorf("blueprint contains no steps")
	}
	stepIDs := make(map[string]struct{}, len(blueprint.Steps))
	for _, step := range blueprint.Steps {
		if step.ID == "" {
			return fmt.Errorf("blueprint step id is required")
		}
		if _, exists := stepIDs[step.ID]; exists {
			return fmt.Errorf("blueprint contains duplicate step %q", step.ID)
		}
		stepIDs[step.ID] = struct{}{}
		switch step.Kind {
		case "tool":
			if step.Tool == "" {
				return fmt.Errorf("tool step %q requires tool", step.ID)
			}
		case "agent":
			if step.AgentDefinition == "" {
				return fmt.Errorf("agent step %q requires agentDefinition", step.ID)
			}
		case "transform", "condition", "wait", "approval":
		default:
			return fmt.Errorf("unsupported blueprint step kind %q", step.Kind)
		}
	}
	for _, step := range blueprint.Steps {
		for _, dependency := range step.DependsOn {
			if _, exists := stepIDs[dependency]; !exists {
				return fmt.Errorf("step %q depends on unknown step %q", step.ID, dependency)
			}
		}
	}
	return nil
}

func validateScope(scope map[string]any) error {
	if len(scope) == 0 {
		return fmt.Errorf("workflow execution scope is empty")
	}
	validKeys := map[string]struct{}{"ids": {}}
	for key, raw := range scope {
		if _, ok := validKeys[key]; !ok {
			return fmt.Errorf("unsupported scope field %q", key)
		}
		values, ok := raw.([]any)
		if !ok || len(values) == 0 {
			return fmt.Errorf("scope field %q must contain at least one value", key)
		}
		for _, value := range values {
			if text, ok := value.(string); !ok || text == "" {
				return fmt.Errorf("scope field %q contains an invalid value", key)
			}
		}
	}
	return nil
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

func cloneMap(source map[string]any) map[string]any {
	clone := make(map[string]any, len(source))
	for key, value := range source {
		clone[key] = value
	}
	return clone
}
