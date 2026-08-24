package mock

import (
	"encoding/json"
	"fmt"
	"strings"
)

const fixedObservedAt = "2026-01-01T00:00:00Z"

// AgentStepSummary returns a concise, deterministic result for local runs.
// It intentionally does not pretend to be a model transcript.
func AgentStepSummary(definition string) string {
	if definition == "" {
		definition = "unnamed-agent"
	}
	return fmt.Sprintf("Mock AI completed the %s step using the supplied evidence.", definition)
}

// Summary returns the local fixture used by synthesis-like activities.
func Summary() string {
	return "Mock AI found no blocking change and produced a reviewable evidence summary."
}

// WorkflowChangePlanJSON returns a contract-valid, approval-gated plan for
// local coordinator and workflow-creator flows. Values present in the prompt
// are carried into the plan so the fixture remains tenant-scoped.
func WorkflowChangePlanJSON(prompt string) (string, error) {
	coordinatorID := promptValue(prompt, "Coordinator ID:")
	organizationID := promptValue(prompt, "Organization ID:")
	projectID := promptValue(prompt, "Project ID:")
	if coordinatorID == "" {
		coordinatorID = "mock-coordinator"
	}
	if organizationID == "" {
		organizationID = "mock-organization"
	}

	blueprint := map[string]any{
		"contractVersion": "workflow-blueprint.v1",
		"blueprintId":     "mock-context-summary",
		"version":         "1.0.0",
		"name":            "Mock context summary",
		"workflowType":    "encois.dynamic.v1",
		"purpose":         "Produce a deterministic local evidence summary.",
		"enabled":         true,
		"steps": []map[string]any{{
			"id":              "mock-summary",
			"kind":            "agent",
			"agentDefinition": "context.summarizer.v1",
		}},
		"requiresApproval": true,
	}

	plan := map[string]any{
		"contractVersion": "workflow-change-plan.v1",
		"planId":          "mock-plan-" + safeID(coordinatorID),
		"coordinatorId":   coordinatorID,
		"organizationId":  organizationID,
		"observedAt":      fixedObservedAt,
		"evidenceRefs":    []string{"mock://ai/evidence/local-fixture"},
		"changes": []map[string]any{{
			"kind":             "create",
			"blueprint":        blueprint,
			"reason":           "Mock AI proposed a read-only local demonstration workflow.",
			"evidenceRefs":     []string{"mock://ai/evidence/local-fixture"},
			"requiresApproval": true,
			"start":            map[string]any{"key": "mock-local-run"},
		}},
	}
	if projectID != "" {
		plan["projectId"] = projectID
	}

	encoded, err := json.Marshal(plan)
	if err != nil {
		return "", fmt.Errorf("encode mock workflow change plan: %w", err)
	}
	return string(encoded), nil
}

func promptValue(prompt, label string) string {
	for _, line := range strings.Split(prompt, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, label) {
			return strings.TrimSpace(strings.TrimPrefix(trimmed, label))
		}
	}
	return ""
}

func safeID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "coordinator"
	}
	var builder strings.Builder
	for _, character := range value {
		switch {
		case character >= 'a' && character <= 'z':
			builder.WriteRune(character)
		case character >= 'A' && character <= 'Z':
			builder.WriteRune(character + ('a' - 'A'))
		case character >= '0' && character <= '9', character == '-', character == '_':
			builder.WriteRune(character)
		default:
			builder.WriteRune('-')
		}
	}
	return strings.Trim(builder.String(), "-")
}
