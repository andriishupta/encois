package coordinator

import "testing"

func TestWorkflowCreatorRejectsUnregisteredWorkflowType(t *testing.T) {
	creator := NewWorkflowCreator([]string{UserBlueprintWorkflowType})
	err := creator.ValidatePlan(WorkflowChangePlan{
		ContractVersion: WorkflowChangePlanVersion,
		PlanID:          "plan-1",
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		Changes: []WorkflowChange{{
			Kind:   ChangeCreate,
			Reason: "Test the workflow type boundary.",
			Start: &WorkflowStartIntent{Key: "release-aug-30"},
			Blueprint: &WorkflowBlueprint{
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
	creator := NewWorkflowCreator([]string{UserBlueprintWorkflowType})
	err := creator.ValidatePlan(WorkflowChangePlan{
		ContractVersion: WorkflowChangePlanVersion,
		PlanID:          "plan-1",
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		Changes: []WorkflowChange{{
			Kind:   ChangeCreate,
			Reason: "Create a registered workflow.",
			Start: &WorkflowStartIntent{Key: "release-aug-30"},
			Blueprint: &WorkflowBlueprint{
				BlueprintID:  "release-risk",
				Version:      "1.0.0",
				WorkflowType: UserBlueprintWorkflowType,
			},
		}},
	})
	if err != nil {
		t.Fatalf("expected registered workflow type to be accepted: %v", err)
	}
}

func TestWorkflowCreatorSeparatesBlueprintAndWorkflowTargets(t *testing.T) {
	creator := NewWorkflowCreator([]string{UserBlueprintWorkflowType})
	err := creator.ValidatePlan(WorkflowChangePlan{
		ContractVersion: WorkflowChangePlanVersion,
		PlanID:          "plan-lifecycle",
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		Changes: []WorkflowChange{
			{
				Kind:                   ChangeUpdate,
				TargetBlueprintID:      "release-readiness",
				TargetBlueprintVersion: "1.0.0",
				Blueprint:              &WorkflowBlueprint{BlueprintID: "release-readiness", Version: "2.0.0", WorkflowType: UserBlueprintWorkflowType},
				Reason:                 "Publish a new revision.",
			},
			{Kind: ChangeDeprecate, TargetBlueprintID: "release-readiness", TargetBlueprintVersion: "0.9.0", Reason: "Retire old revision."},
			{Kind: ChangeCancel, TargetWorkflowID: "workflow:org-1:encois.user-blueprint.v1:release-1", Reason: "Cancel execution."},
		},
	})
	if err != nil {
		t.Fatalf("expected valid lifecycle plan: %v", err)
	}
}

func TestWorkflowCreatorRejectsMixedTargetIdentity(t *testing.T) {
	creator := NewWorkflowCreator([]string{UserBlueprintWorkflowType})
	err := creator.ValidatePlan(WorkflowChangePlan{
		ContractVersion: WorkflowChangePlanVersion,
		PlanID:          "plan-invalid-lifecycle",
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		Changes: []WorkflowChange{{
			Kind:                   ChangeDeprecate,
			TargetWorkflowID:       "workflow:org-1:encois.user-blueprint.v1:release-1",
			TargetBlueprintVersion: "1.0.0",
			Reason:                 "Ambiguous target.",
		}},
	})
	if err == nil {
		t.Fatal("expected lifecycle plan with a missing Blueprint target id to be rejected")
	}
}
