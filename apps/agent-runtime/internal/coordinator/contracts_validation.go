package coordinator

import (
	"fmt"
	"strings"

	contractschemas "github.com/andriishupta/encois/packages/contracts"
)

func ValidateCoordinatorStartInput(input CoordinatorStartInput) error {
	if err := contractschemas.Validate(contractschemas.SchemaCoordinator, input); err != nil {
		return fmt.Errorf("validate coordinator contract: %w", err)
	}
	if input.CoordinatorID == "" || input.OrganizationID == "" || input.PolicyVersion == "" {
		return fmt.Errorf("coordinatorId, organizationId, and policyVersion are required")
	}
	return nil
}

func ValidateBootstrapProjectInput(input BootstrapProjectInput) error {
	if err := contractschemas.Validate(contractschemas.SchemaBootstrapProject, input); err != nil {
		return fmt.Errorf("validate bootstrap project contract: %w", err)
	}
	return nil
}

func ValidateCoordinatorEvent(event CoordinatorEvent) error {
	if err := contractschemas.Validate(contractschemas.SchemaCoordinatorEvent, event); err != nil {
		return fmt.Errorf("validate coordinator event contract: %w", err)
	}
	if event.EventType == string(contractschemas.EventWorkflowStartRequested) {
		if event.ActorID == "" || event.BlueprintID == "" || event.BlueprintVersion == "" || event.WorkflowID == "" || event.Key == "" || len(event.Scope) == 0 {
			return fmt.Errorf("workflow start event is incomplete")
		}
	}
	return nil
}

func ValidateCoordinatorSignal(signal CoordinatorSignal) error {
	if signal.ContractVersion != CoordinatorContractVersion {
		return fmt.Errorf("unsupported coordinator signal contractVersion %q", signal.ContractVersion)
	}
	if strings.TrimSpace(signal.EventID) == "" {
		return fmt.Errorf("coordinator signal eventId is required")
	}
	return nil
}
