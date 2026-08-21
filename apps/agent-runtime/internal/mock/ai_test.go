package mock

import (
	"encoding/json"
	"testing"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
	contractschemas "github.com/andriishupta/encois/packages/contracts"
)

func TestWorkflowChangePlanJSONIsContractShaped(t *testing.T) {
	raw, err := WorkflowChangePlanJSON("Organization ID: org-test\nProject ID: project-test\nCoordinator ID: coordinator-test")
	if err != nil {
		t.Fatalf("create mock plan: %v", err)
	}

	var plan map[string]any
	if err := json.Unmarshal([]byte(raw), &plan); err != nil {
		t.Fatalf("decode mock plan: %v", err)
	}
	if plan["organizationId"] != "org-test" || plan["coordinatorId"] != "coordinator-test" {
		t.Fatalf("mock plan lost scope fields: %+v", plan)
	}
	if plan["contractVersion"] != "workflow-change-plan.v1" {
		t.Fatalf("unexpected contract version: %+v", plan["contractVersion"])
	}

	var typedPlan coordinator.WorkflowChangePlan
	if err := json.Unmarshal([]byte(raw), &typedPlan); err != nil {
		t.Fatalf("decode typed mock plan: %v", err)
	}
	if err := contractschemas.Validate(contractschemas.SchemaWorkflowChangePlan, typedPlan); err != nil {
		t.Fatalf("mock plan must satisfy the shared contract: %v", err)
	}
	if err := coordinator.NewWorkflowCreator(nil).ValidatePlan(typedPlan); err != nil {
		t.Fatalf("mock plan must satisfy coordinator semantics: %v", err)
	}
}

func TestAgentStepSummaryIsConcise(t *testing.T) {
	if got := AgentStepSummary("context.summarizer.v1"); got != "Mock AI completed the context.summarizer.v1 step using the supplied evidence." {
		t.Fatalf("unexpected mock summary: %q", got)
	}
}
