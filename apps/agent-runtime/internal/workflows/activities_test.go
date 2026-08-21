package workflows

import (
	"context"
	"testing"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/agents"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
	contracts "github.com/andriishupta/encois/packages/contracts"
)

func TestBlueprintToolActivityWithoutGatewayIsDeferred(t *testing.T) {
	activities := NewActivities(&agents.Bundle{}, "")
	result, err := activities.ExecuteBlueprintStep(context.Background(), BlueprintStepInput{
		Step: coordinator.WorkflowStep{ID: "jira", Kind: "tool", Tool: "jira.search_issues"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "waiting" || result.StatusReason != contracts.ReasonCapabilityMissing {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestBlueprintAgentActivityWithoutModelIsDeferred(t *testing.T) {
	activities := NewActivities(&agents.Bundle{}, "")
	result, err := activities.ExecuteBlueprintStep(context.Background(), BlueprintStepInput{
		Step: coordinator.WorkflowStep{ID: "summarize", Kind: "agent", AgentDefinition: "context.summarizer.v1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "waiting" || result.StatusReason != contracts.ReasonCapabilityMissing {
		t.Fatalf("unexpected result: %+v", result)
	}
}
