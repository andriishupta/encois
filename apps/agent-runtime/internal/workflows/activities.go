package workflows

import (
	"context"
	"fmt"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/agents"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/gatewayclient"
)

type Activities struct {
	agentBundle  *agents.Bundle
	agentGateway *gatewayclient.Client
}

func NewActivities(agentBundle *agents.Bundle, agentGatewayURL string) *Activities {
	var client *gatewayclient.Client
	if agentGatewayURL != "" {
		client = gatewayclient.New(agentGatewayURL)
	}
	return &Activities{agentBundle: agentBundle, agentGateway: client}
}

func (a *Activities) ExecuteBlueprintStep(ctx context.Context, input BlueprintStepInput) (BlueprintStepResult, error) {
	switch input.Step.Kind {
	case "tool":
		if a.agentGateway == nil {
			return BlueprintStepResult{StepID: input.Step.ID, Status: "deferred-no-agent-gateway"}, nil
		}
		result, err := a.agentGateway.Invoke(ctx, gatewayclient.ToolRequest{
			ContractVersion: "tool-request.v1",
			RequestID:       input.RequestID,
			WorkflowID:      input.WorkflowID,
			OrganizationID:  input.OrganizationID,
			ActorID:         input.ActorID,
			PolicyVersion:   input.PolicyVersion,
			AgentDefinition: input.Step.AgentDefinition,
			Tool:            input.Step.Tool,
			Input:           map[string]any{"input": input.Step.Input, "priorResults": input.PriorResults},
		})
		if err != nil {
			return BlueprintStepResult{}, err
		}
		return BlueprintStepResult{StepID: input.Step.ID, Status: result.Status, Data: result.Data, EvidenceRefs: result.EvidenceRefs}, nil
	case "agent":
		if a.agentBundle == nil || !a.agentBundle.Enabled || a.agentBundle.AgentModel == nil {
			return BlueprintStepResult{StepID: input.Step.ID, Status: "deferred-no-agent-model"}, nil
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
