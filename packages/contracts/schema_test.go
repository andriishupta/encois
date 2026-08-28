package contracts

import "testing"

func TestCanonicalSchemasValidateRepresentativeWireValues(t *testing.T) {
	tests := []struct {
		name   string
		schema SchemaName
		value  any
	}{
		{
			name:   "execution context",
			schema: SchemaExecutionContext,
			value:  map[string]any{"contractVersion": "execution-context.v1", "requestId": "req-1", "workflowId": "wf-1", "organizationId": "org-1", "actorId": "actor-1", "policyVersion": "policy-1", "capability": "test-capability", "scope": map[string]any{"ids": []string{"team-a"}}},
		},
		{
			name:   "blueprint",
			schema: SchemaWorkflowBlueprint,
			value: map[string]any{
				"contractVersion": "workflow-blueprint.v1", "blueprintId": "bp-1", "version": "1.0.0",
				"name": "Example", "workflowType": "encois.dynamic.v1", "purpose": "Test", "enabled": true,
				"steps":        []any{map[string]any{"id": "jira", "kind": "tool", "tool": "jira.project_tasks"}},
				"allowedTools": []string{"jira.project_tasks"},
			},
		},
		{
			name:   "tool request",
			schema: SchemaToolRequest,
			value:  map[string]any{"contractVersion": "tool-request.v1", "requestId": "req-1", "workflowId": "wf-1", "organizationId": "org-1", "actorId": "actor-1", "policyVersion": "policy-1", "capability": "test-capability", "blueprintId": "bp-1", "blueprintVersion": "1.0.0", "allowedTools": []string{"jira.project_tasks"}, "scope": map[string]any{"ids": []string{"team-a"}}, "tool": "jira.project_tasks", "arguments": map[string]any{}},
		},
		{
			name:   "tool result",
			schema: SchemaToolResult,
			value:  map[string]any{"contractVersion": "tool-result.v1", "requestId": "req-1", "tool": "jira.project_tasks", "status": "completed"},
		},
		{
			name:   "artifact write",
			schema: SchemaArtifactWrite,
			value: map[string]any{
				"contractVersion": "artifact-write.v1", "requestId": "artifact-1", "workflowId": "wf-1",
				"organizationId": "org-1", "actorId": "actor-1", "policyVersion": "policy-1",
				"capability": "test-capability",
				"scope":      map[string]any{"ids": []string{"team-a"}}, "objectKey": "evidence/release.json",
				"contentType": "application/json", "dataRef": "provider:jira:release-1",
			},
		},
		{
			name:   "artifact result",
			schema: SchemaArtifactWriteResult,
			value:  map[string]any{"contractVersion": "artifact-write-result.v1", "requestId": "artifact-1", "artifactRef": "artifact://memory/abc", "objectKey": "org-1/wf-1/evidence/release.json", "status": "completed"},
		},
		{
			name:   "graph query",
			schema: SchemaGraphQuery,
			value: map[string]any{
				"contractVersion": "graph-query.v1", "requestId": "graph-1", "workflowId": "wf-1", "organizationId": "org-1",
				"actorId": "actor-1", "policyVersion": "policy-1", "scope": map[string]any{"ids": []string{"team-a"}},
				"capability": "test-capability",
				"query":      "release.related_entities", "params": map[string]any{"releaseKey": "aug-30"},
			},
		},
		{
			name:   "graph query result",
			schema: SchemaGraphQueryResult,
			value: map[string]any{
				"contractVersion": "graph-query-result.v1", "requestId": "graph-1", "status": "completed",
				"nodes": []any{map[string]any{"id": "release-1", "type": "release", "properties": map[string]any{"key": "aug-30"}}},
				"edges": []any{map[string]any{"id": "edge-1", "sourceId": "release-1", "targetId": "project-1", "relationship": "belongs_to", "properties": map[string]any{}}},
			},
		},
		{
			name:   "agent memory retrieve",
			schema: SchemaAgentMemory,
			value: map[string]any{
				"contractVersion": "agent-memory.v1", "requestId": "memory-1", "workflowId": "wf-1", "organizationId": "org-1",
				"actorId": "actor-1", "policyVersion": "policy-1", "scope": map[string]any{"ids": []string{"team-a"}},
				"capability":      "test-capability",
				"agentDefinition": "release-investigation.synthesizer@1", "operation": "retrieve",
				"memoryScope": map[string]any{"agentDefinition": "release-investigation.synthesizer@1", "projectId": "project-1"},
				"query":       "release risk patterns", "maxResults": 5,
			},
		},
		{
			name:   "agent memory result",
			schema: SchemaAgentMemoryResult,
			value: map[string]any{
				"contractVersion": "agent-memory-result.v1", "requestId": "memory-1", "status": "completed",
				"memories": []any{map[string]any{
					"id": "memory-record-1", "agentDefinition": "release-investigation.synthesizer@1",
					"summary": "Release investigations often need a QA confirmation.", "evidenceRefs": []string{"artifact://memory/evidence-1"}, "observedAt": "2026-08-20T16:00:00Z",
				}},
			},
		},
		{
			name:   "agent result",
			schema: SchemaAgentResult,
			value: map[string]any{
				"contractVersion": "agent-result.v1", "status": "success", "summary": "Grounded result.",
				"sources": []string{"source://one"}, "evidence": []any{map[string]any{"reference": "source://one", "claim": "Observed fact."}}, "warnings": []string{},
			},
		},
		{
			name:   "agent instructions",
			schema: SchemaAgentInstructions,
			value: map[string]any{
				"contractVersion": "agent-instructions.v1", "role": "test-agent", "outputContract": "agent-result.v1",
				"must": []string{"Return JSON."}, "mustNot": []string{"Invent facts."},
				"inputExample": map[string]any{}, "outputExample": map[string]any{},
			},
		},
		{
			name:   "tool manifest",
			schema: SchemaToolManifest,
			value: map[string]any{
				"contractVersion": "tool-manifest.v1", "name": "jira.project_tasks", "version": "1.0.0", "kind": "tool",
				"description": "Read project task status from Jira.", "sideEffects": "read-only",
				"inputSchema": map[string]any{"type": "object"}, "outputSchema": map[string]any{"type": "object"},
				"annotations":   map[string]any{"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false},
				"requiredScope": []string{"ids"}, "available": true, "approvalRequired": false,
			},
		},
		{
			name:   "workflow signal",
			schema: SchemaWorkflowSignal,
			value:  map[string]any{"contractVersion": "workflow-signal.v1", "signalName": "blueprint-approval", "signalId": "signal-1", "payload": map[string]any{"stepId": "approval", "approved": true}},
		},
		{
			name:   "coordinator event",
			schema: SchemaCoordinatorEvent,
			value: map[string]any{
				"contractVersion": "coordinator-event.v1", "eventId": "event-1", "eventType": "workflow-completed",
				"coordinatorId": "coord-1", "organizationId": "org-1", "actorId": "user-1", "approved": true,
				"blueprintId": "blueprint-1", "blueprintVersion": "1.0.0", "scope": map[string]any{"ids": []string{"project-1"}},
			},
		},
		{
			name:   "workflow update",
			schema: SchemaWorkflowUpdate,
			value: map[string]any{
				"contractVersion": "workflow-update.v1", "updateName": "blueprint-context", "updateId": "update-1",
				"payload": map[string]any{"businessInput": map[string]any{"releaseKey": "aug-30"}},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := Validate(test.schema, test.value); err != nil {
				t.Fatalf("canonical schema rejected valid value: %v", err)
			}
		})
	}
}

func TestCanonicalSchemaRejectsInvalidToolStepAndScope(t *testing.T) {
	invalidBlueprint := map[string]any{
		"contractVersion": "workflow-blueprint.v1", "blueprintId": "bp-1", "version": "1.0.0",
		"name": "Example", "workflowType": "encois.dynamic.v1", "purpose": "Test", "enabled": true,
		"steps": []any{map[string]any{"id": "jira", "kind": "tool"}},
	}
	if err := Validate(SchemaWorkflowBlueprint, invalidBlueprint); err == nil {
		t.Fatal("expected a tool step without tool to be rejected")
	}

	invalidRequest := map[string]any{
		"contractVersion": "tool-request.v1", "requestId": "req-1", "workflowId": "wf-1",
		"organizationId": "org-1", "actorId": "actor-1", "policyVersion": "policy-1",
		"scope": map[string]any{"projectIds": []string{"project-a"}}, "tool": "jira.project_tasks", "arguments": map[string]any{},
	}
	if err := Validate(SchemaToolRequest, invalidRequest); err == nil {
		t.Fatal("expected a tool request without scope.ids to be rejected")
	}

}
