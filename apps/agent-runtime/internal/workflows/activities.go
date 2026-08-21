package workflows

import (
	"context"
	"fmt"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/agents"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/gatewayclient"
	contractschemas "github.com/andriishupta/encois/packages/contracts"
)

type Activities struct {
	agentBundle  *agents.Bundle
	agentGateway *gatewayclient.Client
}

// ValidateBlueprintContract runs outside deterministic Workflow code and
// checks the same canonical schema consumed by the TypeScript API. The
// execution context has its own schema because the Blueprint contract is the
// workflow input envelope, not the context object itself.
func ValidateBlueprintContract(_ context.Context, input BlueprintWorkflowInput) error {
	blueprint := input.Blueprint
	if blueprint.WorkflowType == "" {
		blueprint = input.Payload
	}
	if err := contractschemas.Validate(contractschemas.SchemaWorkflowBlueprint, blueprint); err != nil {
		return fmt.Errorf("validate blueprint contract: %w", err)
	}
	executionContext := map[string]any{
		"contractVersion": string(contractschemas.ContractExecutionContext),
		"requestId":       input.RequestID,
		"workflowId":      input.WorkflowID,
		"organizationId":  input.OrganizationID,
		"actorId":         input.ActorID,
		"policyVersion":   input.PolicyVersion,
		"scope":           input.Scope,
	}
	if input.TraceID != "" {
		executionContext["traceId"] = input.TraceID
	}
	return contractschemas.Validate(contractschemas.SchemaExecutionContext, executionContext)
}

// ValidateBlueprintResult keeps the result contract check at the Go boundary
// before Temporal returns the result to the control plane.
func ValidateBlueprintResult(_ context.Context, result BlueprintWorkflowResult) error {
	if err := contractschemas.Validate(contractschemas.SchemaWorkflowResult, result); err != nil {
		return fmt.Errorf("validate blueprint result: %w", err)
	}
	return nil
}

func NewActivities(agentBundle *agents.Bundle, agentGatewayURL string, serviceToken ...string) *Activities {
	var client *gatewayclient.Client
	if agentGatewayURL != "" {
		if len(serviceToken) > 1 {
			client = gatewayclient.NewWithAudience(agentGatewayURL, serviceToken[0], serviceToken[1])
		} else {
			client = gatewayclient.New(agentGatewayURL, serviceToken...)
		}
	}
	return &Activities{agentBundle: agentBundle, agentGateway: client}
}

func (a *Activities) ExecuteBlueprintStep(ctx context.Context, input BlueprintStepInput) (BlueprintStepResult, error) {
	switch input.Step.Kind {
	case "tool":
		if a.agentGateway == nil {
			return BlueprintStepResult{
				StepID:       input.Step.ID,
				Status:       string(contractschemas.WorkflowResultWaiting),
				StatusReason: contractschemas.ReasonCapabilityMissing,
			}, nil
		}
		result, err := a.agentGateway.Invoke(ctx, gatewayclient.ToolRequest{
			ContractVersion: string(contractschemas.ContractToolRequest),
			RequestID:       input.RequestID,
			TraceID:         input.TraceID,
			WorkflowID:      input.WorkflowID,
			RunID:           input.RunID,
			OrganizationID:  input.OrganizationID,
			ActorID:         input.ActorID,
			PolicyVersion:   input.PolicyVersion,
			Scope:           input.Scope,
			AgentDefinition: input.Step.AgentDefinition,
			Tool:            input.Step.Tool,
			Arguments:       map[string]any{"input": input.Step.Input, "businessInput": input.BusinessInput, "priorResults": input.PriorResults},
		})
		if err != nil {
			return BlueprintStepResult{}, err
		}
		return BlueprintStepResult{StepID: input.Step.ID, Status: result.Status, Data: result.Data, EvidenceRefs: result.EvidenceRefs, Freshness: result.Freshness}, nil
	case "agent":
		if a.agentBundle == nil || !a.agentBundle.Enabled || (a.agentBundle.Mode != agents.ModeMock && a.agentBundle.AgentModel == nil) {
			return BlueprintStepResult{
				StepID:       input.Step.ID,
				Status:       string(contractschemas.WorkflowResultWaiting),
				StatusReason: contractschemas.ReasonCapabilityMissing,
			}, nil
		}
		summary, err := a.agentBundle.RunAgentStep(ctx, input.WorkflowID+":"+input.Step.ID, input.Step.AgentDefinition, map[string]any{
			"input":        input.Step.Input,
			"priorResults": input.PriorResults,
		})
		if err != nil {
			return BlueprintStepResult{}, err
		}
		return BlueprintStepResult{StepID: input.Step.ID, Status: "model-generated", Data: map[string]any{
			"summary":         summary,
			"agentDefinition": input.Step.AgentDefinition,
		}}, nil
	default:
		return BlueprintStepResult{}, fmt.Errorf("step kind %q is handled by the workflow, not an activity", input.Step.Kind)
	}
}
