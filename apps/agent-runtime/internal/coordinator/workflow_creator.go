package coordinator

import "fmt"

// WorkflowCreator is the deterministic boundary around model-generated plans.
// The actual persistence and Temporal Schedule API calls belong to the Gateway API.
type WorkflowCreator struct {
	allowedWorkflowTypes map[string]struct{}
}

func NewWorkflowCreator(allowedWorkflowTypes []string) WorkflowCreator {
	if len(allowedWorkflowTypes) == 0 {
		allowedWorkflowTypes = []string{UserBlueprintWorkflowType}
	}
	allowed := make(map[string]struct{}, len(allowedWorkflowTypes))
	for _, workflowType := range allowedWorkflowTypes {
		allowed[workflowType] = struct{}{}
	}
	return WorkflowCreator{allowedWorkflowTypes: allowed}
}

func (c WorkflowCreator) ValidatePlan(plan WorkflowChangePlan) error {
	if plan.ContractVersion != WorkflowChangePlanVersion {
		return fmt.Errorf("unsupported workflow change plan version %q", plan.ContractVersion)
	}
	if plan.PlanID == "" || plan.CoordinatorID == "" || plan.OrganizationID == "" {
		return fmt.Errorf("plan id, coordinator id, and organization id are required")
	}
	if len(plan.Changes) == 0 {
		return fmt.Errorf("workflow change plan must contain at least one change")
	}
	for index, change := range plan.Changes {
		if change.Reason == "" {
			return fmt.Errorf("change %d requires a reason", index)
		}
		switch change.Kind {
		case ChangeCreate:
			if change.TargetBlueprintID != "" || change.TargetBlueprintVersion != "" || change.TargetWorkflowID != "" {
				return fmt.Errorf("change %d cannot include a lifecycle target", index)
			}
			if err := c.validateBlueprintChange(index, change.Blueprint); err != nil {
				return err
			}
			if err := validateStartIntent(index, change.Start, change.Blueprint, change.Kind); err != nil {
				return err
			}
		case ChangeUpdate:
			if change.TargetBlueprintID == "" || change.TargetBlueprintVersion == "" {
				return fmt.Errorf("change %d requires a target Blueprint id and version", index)
			}
			if change.TargetWorkflowID != "" {
				return fmt.Errorf("change %d cannot target a Temporal execution", index)
			}
			if err := c.validateBlueprintChange(index, change.Blueprint); err != nil {
				return err
			}
			if change.Blueprint.BlueprintID != change.TargetBlueprintID {
				return fmt.Errorf("change %d target Blueprint id does not match the replacement Blueprint", index)
			}
			if change.Blueprint.Version == change.TargetBlueprintVersion {
				return fmt.Errorf("change %d replacement Blueprint must use a new version", index)
			}
			if err := validateStartIntent(index, change.Start, change.Blueprint, change.Kind); err != nil {
				return err
			}
		case ChangeDeprecate:
			if change.TargetBlueprintID == "" || change.TargetBlueprintVersion == "" {
				return fmt.Errorf("change %d requires a target Blueprint id and version", index)
			}
			if change.TargetWorkflowID != "" {
				return fmt.Errorf("change %d cannot target a Temporal execution", index)
			}
			if change.Start != nil {
				return fmt.Errorf("change %d cannot start a deprecation", index)
			}
		case ChangeRestore, ChangeSetCurrent:
			if change.TargetBlueprintID == "" || change.TargetBlueprintVersion == "" {
				return fmt.Errorf("change %d requires a target Blueprint id and version", index)
			}
			if change.TargetWorkflowID != "" || change.Blueprint != nil || change.Start != nil {
				return fmt.Errorf("change %d cannot target a Temporal execution or carry a Blueprint/start intent", index)
			}
		case ChangeCancel:
			if change.TargetWorkflowID == "" {
				return fmt.Errorf("change %d requires a target workflow id", index)
			}
			if change.TargetBlueprintID != "" || change.TargetBlueprintVersion != "" || change.Blueprint != nil {
				return fmt.Errorf("change %d cannot target a Blueprint registry object", index)
			}
			if change.Start != nil {
				return fmt.Errorf("change %d cannot start a cancellation", index)
			}
		default:
			return fmt.Errorf("change %d has unsupported kind %q", index, change.Kind)
		}
	}
	return nil
}

func (c WorkflowCreator) validateBlueprintChange(index int, blueprint *WorkflowBlueprint) error {
	if blueprint == nil || blueprint.BlueprintID == "" || blueprint.Version == "" {
		return fmt.Errorf("change %d has an incomplete blueprint", index)
	}
	if blueprint.WorkflowType != UserBlueprintWorkflowType {
		return fmt.Errorf("change %d must use generic workflow type %q", index, UserBlueprintWorkflowType)
	}
	if _, ok := c.allowedWorkflowTypes[blueprint.WorkflowType]; !ok {
		return fmt.Errorf("workflow type %q is not registered", blueprint.WorkflowType)
	}
	return nil
}

func validateStartIntent(index int, start *WorkflowStartIntent, blueprint *WorkflowBlueprint, kind WorkflowChangeKind) error {
	if start == nil {
		return nil
	}
	if kind != ChangeCreate && kind != ChangeUpdate {
		return fmt.Errorf("change %d cannot start a non-executable change", index)
	}
	if blueprint == nil || start.Key == "" {
		return fmt.Errorf("change %d has an incomplete start intent", index)
	}
	return nil
}
