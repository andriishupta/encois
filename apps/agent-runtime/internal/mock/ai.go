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

// AgentStepJSON returns the same result envelope used by the Gemini path.
func AgentStepJSON(definition string) (string, error) {
	if definition == "" {
		definition = "unnamed-agent"
	}
	result := map[string]any{
		"contractVersion": "agent-result.v1",
		"status":          "success",
		"summary":         fmt.Sprintf("Mock AI completed the %s step using the supplied evidence.", definition),
		"sources":         []string{"mock://ai/evidence/local-fixture"},
		"evidence": []map[string]string{
			{"reference": "mock://ai/evidence/local-fixture", "claim": "Deterministic local fixture evidence."},
		},
		"warnings": []string{},
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("encode mock agent result: %w", err)
	}
	return string(encoded), nil
}

// Summary returns the local fixture used by synthesis-like activities.
func Summary() string {
	return "Mock AI found no blocking change and produced a reviewable evidence summary."
}
