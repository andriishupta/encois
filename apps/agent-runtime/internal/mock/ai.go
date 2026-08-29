package mock

import (
	"encoding/json"
	"fmt"
)

// AgentStepSummary returns a concise, deterministic result for local runs.
// It intentionally does not pretend to be a model transcript.
func AgentStepSummary(definition string) string {
	if definition == "" {
		definition = "unnamed-agent"
	}
	return fmt.Sprintf("Mock AI completed the %s step using the supplied evidence.", definition)
}

// AgentStepJSON returns the same result envelope used by the Gemini path and
// references only evidence present in the supplied structured input.
func AgentStepJSON(definition string, input map[string]any) (string, error) {
	if definition == "" {
		definition = "unnamed-agent"
	}
	evidenceRefs, err := suppliedEvidenceReferences(input)
	if err != nil {
		return "", err
	}
	evidence := make([]map[string]string, 0, len(evidenceRefs))
	for _, reference := range evidenceRefs {
		evidence = append(evidence, map[string]string{
			"reference": reference,
			"claim":     "Deterministic conclusion grounded in supplied fixture evidence.",
		})
	}
	status := "success"
	warnings := []string{}
	if len(evidenceRefs) == 0 {
		status = "no_evidence"
		warnings = append(warnings, "No scoped fixture evidence was supplied.")
	}
	result := map[string]any{
		"contractVersion": "agent-result.v1",
		"status":          status,
		"summary":         fmt.Sprintf("Mock AI completed the %s step using the supplied evidence.", definition),
		"sources":         evidenceRefs,
		"evidence":        evidence,
		"warnings":        warnings,
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("encode mock agent result: %w", err)
	}
	return string(encoded), nil
}

func suppliedEvidenceReferences(input map[string]any) ([]string, error) {
	encoded, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("encode mock agent input: %w", err)
	}
	var normalized any
	if err := json.Unmarshal(encoded, &normalized); err != nil {
		return nil, fmt.Errorf("decode mock agent input: %w", err)
	}
	seen := map[string]struct{}{}
	refs := []string{}
	var visit func(any)
	visit = func(value any) {
		switch typed := value.(type) {
		case map[string]any:
			for key, nested := range typed {
				if key == "evidenceRefs" {
					if values, ok := nested.([]any); ok {
						for _, value := range values {
							if reference, ok := value.(string); ok && reference != "" {
								if _, exists := seen[reference]; !exists {
									seen[reference] = struct{}{}
									refs = append(refs, reference)
								}
							}
						}
					}
				}
				visit(nested)
			}
		case []any:
			for _, nested := range typed {
				visit(nested)
			}
		}
	}
	visit(normalized)
	return refs, nil
}

// Summary returns the local fixture used by synthesis-like activities.
func Summary() string {
	return "Mock AI found no blocking change and produced a reviewable evidence summary."
}
