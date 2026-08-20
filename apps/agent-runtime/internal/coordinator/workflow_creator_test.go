package coordinator

import "testing"

func TestWorkflowCreatorRejectsUnregisteredWorkflowType(t *testing.T) {
	creator := NewWorkflowCreator([]string{"ReleaseRiskWorkflow"})
	err := creator.ValidatePlan(WorkflowChangePlan{
		ContractVersion: WorkflowChangePlanVersion,
		PlanID:          "plan-1",
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		Changes: []WorkflowChange{{
			Kind: ChangeCreate,
			Blueprint: WorkflowBlueprint{
				BlueprintID:  "unknown",
				Version:      "1.0.0",
				WorkflowType: "PromptInventedWorkflow",
			},
		}},
	})
	if err == nil {
		t.Fatal("expected unregistered workflow type to be rejected")
	}
}

func TestWorkflowCreatorAcceptsRegisteredWorkflowType(t *testing.T) {
	creator := NewWorkflowCreator([]string{"ReleaseRiskWorkflow"})
	err := creator.ValidatePlan(WorkflowChangePlan{
		ContractVersion: WorkflowChangePlanVersion,
		PlanID:          "plan-1",
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		Changes: []WorkflowChange{{
			Kind: ChangeCreate,
			Blueprint: WorkflowBlueprint{
				BlueprintID:  "release-risk",
				Version:      "1.0.0",
				WorkflowType: "ReleaseRiskWorkflow",
			},
		}},
	})
	if err != nil {
		t.Fatalf("expected registered workflow type to be accepted: %v", err)
	}
}
