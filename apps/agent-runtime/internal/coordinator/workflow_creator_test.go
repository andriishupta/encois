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
			Kind:  ChangeCreate,
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
			Kind:  ChangeCreate,
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

func TestWorkflowCreatorV2SeparatesBlueprintAndWorkflowTargets(t *testing.T) {
	creator := NewWorkflowCreator([]string{UserBlueprintWorkflowType})
	err := creator.ValidatePlanV2(WorkflowChangePlanV2{
		ContractVersion: WorkflowChangePlanV2Version,
		PlanID:          "plan-v2",
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		Changes: []WorkflowChangeV2{
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
		t.Fatalf("expected valid v2 lifecycle plan: %v", err)
	}
}

func TestWorkflowCreatorV2RejectsMixedTargetIdentity(t *testing.T) {
	creator := NewWorkflowCreator([]string{UserBlueprintWorkflowType})
	err := creator.ValidatePlanV2(WorkflowChangePlanV2{
		ContractVersion: WorkflowChangePlanV2Version,
		PlanID:          "plan-invalid-v2",
		CoordinatorID:   "coord-1",
		OrganizationID:  "org-1",
		Changes: []WorkflowChangeV2{{
			Kind:                   ChangeDeprecate,
			TargetWorkflowID:       "workflow:org-1:encois.user-blueprint.v1:release-1",
			TargetBlueprintVersion: "1.0.0",
			Reason:                 "Ambiguous target.",
		}},
	})
	if err == nil {
		t.Fatal("expected v2 lifecycle plan with a missing Blueprint target id to be rejected")
	}
}
