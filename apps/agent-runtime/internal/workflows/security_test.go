package workflows

import (
	"testing"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
)

func securityTestBlueprint() coordinator.WorkflowBlueprint {
	return coordinator.WorkflowBlueprint{
		ContractVersion: "workflow-blueprint.v1",
		BlueprintID:     "security-boundary",
		Version:         "1.0.0",
		Name:            "Security boundary",
		WorkflowType:    "dynamic",
		Purpose:         "Exercise authorization boundaries",
		AllowedTools:    []string{"jira.project_tasks"},
		Steps: []coordinator.WorkflowStep{{
			ID:   "jira",
			Kind: "tool",
			Tool: "jira.project_tasks",
		}},
	}
}

func securityTestWorkflowInput() BlueprintWorkflowInput {
	return BlueprintWorkflowInput{
		ContractVersion: "workflow-blueprint.v1",
		Blueprint:       securityTestBlueprint(),
		RequestID:       "request-security-test",
		WorkflowID:      "workflow:org-security:release-1",
		OrganizationID:  "org-security",
		ActorID:         "actor-security",
		PolicyVersion:   "policy-read-only-v1",
		Scope:           map[string]any{"ids": []any{"team-platform"}},
		Capability:      "capability-bound-to-org-security",
	}
}

func TestBlueprintWorkflowInputRejectsSecurityBoundaryViolations(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*BlueprintWorkflowInput)
	}{
		{name: "cross organization workflow id", mutate: func(input *BlueprintWorkflowInput) { input.WorkflowID = "workflow:org-other:release-1" }},
		{name: "missing capability", mutate: func(input *BlueprintWorkflowInput) { input.Capability = "" }},
		{name: "missing actor", mutate: func(input *BlueprintWorkflowInput) { input.ActorID = "" }},
		{name: "unsupported scope field", mutate: func(input *BlueprintWorkflowInput) {
			input.Scope = map[string]any{"organizationIds": []any{"org-security"}}
		}},
		{name: "empty scope ids", mutate: func(input *BlueprintWorkflowInput) { input.Scope = map[string]any{"ids": []any{}} }},
		{name: "duplicate step ids", mutate: func(input *BlueprintWorkflowInput) {
			input.Blueprint.Steps = append(input.Blueprint.Steps, input.Blueprint.Steps[0])
		}},
		{name: "unknown dependency", mutate: func(input *BlueprintWorkflowInput) { input.Blueprint.Steps[0].DependsOn = []string{"untrusted-step"} }},
		{name: "tool without name", mutate: func(input *BlueprintWorkflowInput) { input.Blueprint.Steps[0].Tool = "" }},
		{name: "unknown step kind", mutate: func(input *BlueprintWorkflowInput) { input.Blueprint.Steps[0].Kind = "write_external_system" }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := securityTestWorkflowInput()
			test.mutate(&input)
			if err := validateBlueprintWorkflowInput(input); err == nil {
				t.Fatal("security boundary violation was accepted")
			}
		})
	}
}

func TestBlueprintExecutionPolicyEnforcesManifestRegistryAndApproval(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*coordinator.WorkflowBlueprint)
	}{
		{name: "tool manifest is required", mutate: func(blueprint *coordinator.WorkflowBlueprint) { blueprint.AllowedTools = nil }},
		{name: "tool must be in manifest", mutate: func(blueprint *coordinator.WorkflowBlueprint) {
			blueprint.AllowedTools = []string{"github.project_activity"}
		}},
		{name: "unknown required scope is denied", mutate: func(blueprint *coordinator.WorkflowBlueprint) {
			blueprint.RequiredScopes = []string{"organization_admin"}
		}},
		{name: "approval requirement needs an approval ancestor", mutate: func(blueprint *coordinator.WorkflowBlueprint) { blueprint.RequiresApproval = true }},
		{name: "unregistered agent is denied", mutate: func(blueprint *coordinator.WorkflowBlueprint) {
			blueprint.Steps = []coordinator.WorkflowStep{{ID: "agent", Kind: "agent", AgentDefinition: "untrusted.agent@99"}}
		}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			blueprint := securityTestBlueprint()
			test.mutate(&blueprint)
			if err := validateBlueprintExecutionPolicy(blueprint, map[string]any{"ids": []string{"team-platform"}}); err == nil {
				t.Fatal("unauthorized blueprint policy was accepted")
			}
		})
	}
}

func TestBlueprintExecutionPolicyAcceptsApprovalAncestorOnly(t *testing.T) {
	blueprint := securityTestBlueprint()
	blueprint.RequiresApproval = true
	blueprint.Steps = []coordinator.WorkflowStep{
		{ID: "approval", Kind: "approval"},
		{ID: "jira", Kind: "tool", Tool: "jira.project_tasks", DependsOn: []string{"approval"}},
	}
	if err := validateBlueprintExecutionPolicy(blueprint, map[string]any{"ids": []string{"team-platform"}}); err != nil {
		t.Fatalf("approval ancestor should satisfy the explicit approval boundary: %v", err)
	}
}
