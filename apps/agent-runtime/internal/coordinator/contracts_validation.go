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
	for index, start := range event.WorkflowStarts {
		if err := ValidateWorkflowStartSpec(start); err != nil {
			return fmt.Errorf("validate workflow start %d: %w", index, err)
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

func ValidateWorkflowStartSpec(spec WorkflowStartSpec) error {
	if strings.TrimSpace(spec.BlueprintID) == "" || strings.TrimSpace(spec.BlueprintVersion) == "" || strings.TrimSpace(spec.Key) == "" {
		return fmt.Errorf("blueprint identity and key are required")
	}
	if err := validateScope(spec.Scope); err != nil {
		return err
	}
	return nil
}

func validateScope(scope map[string]any) error {
	if len(scope) == 0 {
		return fmt.Errorf("scope is required")
	}
	if len(scope) != 1 {
		return fmt.Errorf("scope may contain only ids")
	}
	raw, ok := scope["ids"]
	if !ok {
		return fmt.Errorf("scope.ids is required")
	}
	if values, ok := raw.([]any); ok {
		if len(values) == 0 {
			return fmt.Errorf("scope.ids must not be empty")
		}
		for _, value := range values {
			if text, ok := value.(string); !ok || strings.TrimSpace(text) == "" {
				return fmt.Errorf("scope.ids contains an invalid value")
			}
		}
		return nil
	}
	if values, ok := raw.([]string); ok {
		if len(values) == 0 {
			return fmt.Errorf("scope.ids must not be empty")
		}
		for _, value := range values {
			if strings.TrimSpace(value) == "" {
				return fmt.Errorf("scope.ids contains an invalid value")
			}
		}
		return nil
	}
	return fmt.Errorf("scope.ids must be an array")
}
