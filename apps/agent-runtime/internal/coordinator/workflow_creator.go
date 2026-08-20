package coordinator

import "fmt"

// WorkflowCreator is the deterministic boundary around model-generated plans.
// The actual persistence and Temporal Schedule API calls belong to the Gateway API.
type WorkflowCreator struct {
	allowedWorkflowTypes map[string]struct{}
}

func NewWorkflowCreator(allowedWorkflowTypes []string) WorkflowCreator {
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
		switch change.Kind {
		case ChangeCreate, ChangeUpdate, ChangeDeprecate, ChangeCancel:
		default:
			return fmt.Errorf("change %d has unsupported kind %q", index, change.Kind)
		}
		if change.Kind == ChangeCreate || change.Kind == ChangeUpdate {
			if change.Blueprint.BlueprintID == "" || change.Blueprint.Version == "" {
				return fmt.Errorf("change %d has an incomplete blueprint", index)
			}
			if _, ok := c.allowedWorkflowTypes[change.Blueprint.WorkflowType]; !ok {
				return fmt.Errorf("workflow type %q is not registered", change.Blueprint.WorkflowType)
			}
		}
		if (change.Kind == ChangeUpdate || change.Kind == ChangeDeprecate || change.Kind == ChangeCancel) && change.TargetWorkflowID == "" {
			return fmt.Errorf("change %d requires target workflow id", index)
		}
	}
	return nil
}
