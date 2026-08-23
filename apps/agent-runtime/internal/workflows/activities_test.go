package workflows

import (
	"context"
	"testing"
	"time"

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

func TestBlueprintResultTraceIsContractValid(t *testing.T) {
	if err := ValidateBlueprintResult(context.Background(), BlueprintWorkflowResult{
		ContractVersion: string(contracts.ContractWorkflowResult),
		Status:          contracts.WorkflowResultCompleted,
		Steps: []BlueprintStepResult{{
			StepID: "collect",
			Status: "completed",
			Trace:  &contracts.WorkflowTrace{Provider: "github", DurationMs: 420, Attempt: 1, Outcome: "completed", Redacted: true},
		}},
	}); err != nil {
		t.Fatalf("expected trace-bearing workflow result to validate: %v", err)
	}
}

func TestExecutionTraceCapturesBoundedRuntimeAttributes(t *testing.T) {
	trace := executionTrace(context.Background(), time.Now().Add(-time.Second), "completed", "github.project_activity", &contracts.DataProvenance{Source: "github"}, "")
	if trace.Provider != "github" || trace.Attempt != 1 || trace.Outcome != "completed" || !trace.Redacted || trace.DurationMs < 0 {
		t.Fatalf("unexpected execution trace: %+v", trace)
	}
}
