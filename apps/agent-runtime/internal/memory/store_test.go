package memory

import (
	"context"
	"strings"
	"testing"

	aiplatform "google.golang.org/api/aiplatform/v1beta1"
)

func TestSanitizeRequestRedactsObviousPIIAndSecrets(t *testing.T) {
	request := Request{Distillation: &Distillation{
		Summary:      "Observed 2026-08-20. Contact jane@example.com or +1 555 123 4567; use bearer abcdefghijklmnop.",
		EvidenceRefs: []string{"artifact://evidence/1"},
		ObservedAt:   "2026-08-20T16:00:00Z",
	}}
	sanitized := SanitizeRequest(request)
	if sanitized.Distillation == nil || strings.Contains(sanitized.Distillation.Summary, "jane@example.com") || strings.Contains(sanitized.Distillation.Summary, "abcdefghijklmnop") || !strings.Contains(sanitized.Distillation.Summary, "2026-08-20") {
		t.Fatalf("PII or secret was not redacted: %+v", sanitized.Distillation)
	}
	if sanitized.Distillation.RedactionStatus == "" || sanitized.Distillation.RedactionVersion != RedactionVersion {
		t.Fatalf("redaction metadata missing: %+v", sanitized.Distillation)
	}
}

func TestMockStoreDistillsAndRetrievesScopedMemory(t *testing.T) {
	store := NewMockStore()
	request := Request{
		ContractVersion: "agent-memory.v1",
		RequestID:       "memory-mock-1",
		WorkflowID:      "workflow:org-1:release-1",
		OrganizationID:  "org-1",
		ActorID:         "actor-1",
		Scope:           Scope{IDs: []string{"team-1"}},
		PolicyVersion:   "policy-1",
		Capability:      "test-capability",
		AgentDefinition: "source-ingestion",
		Operation:       "distill",
		MemoryScope:     MemoryScope{AgentDefinition: "source-ingestion", ProjectID: "project-1"},
		Distillation: &Distillation{
			Summary:      "A release blocker requires QA confirmation.",
			EvidenceRefs: []string{"source:source-1:revision-1"},
			ObservedAt:   "2026-08-20T16:00:00Z",
		},
	}
	if _, err := store.Execute(context.Background(), request); err != nil {
		t.Fatalf("distill failed: %v", err)
	}
	retrieval := request
	retrieval.Operation = "retrieve"
	retrieval.Distillation = nil
	retrieval.Query = "blocker"
	result, err := store.Execute(context.Background(), retrieval)
	if err != nil || len(result.Memories) != 1 {
		t.Fatalf("expected one scoped mock memory, result=%+v err=%v", result, err)
	}
}

func TestMockStoreAppliesApprovedMemoryOperationsWithinScope(t *testing.T) {
	store := NewMockStore()
	request := Request{
		ContractVersion: "agent-memory.v1", RequestID: "memory-mutation-seed", WorkflowID: "workflow:org-1:release-1",
		OrganizationID: "org-1", ActorID: "actor-1", Scope: Scope{IDs: []string{"team-1"}}, PolicyVersion: "policy-1", Capability: "test-capability",
		AgentDefinition: "context.synthesizer@1", Operation: "distill", MemoryScope: MemoryScope{AgentDefinition: "context.synthesizer@1"},
		Distillation: &Distillation{Summary: "Original fact.", EvidenceRefs: []string{"source:1"}, ObservedAt: "2026-08-20T16:00:00Z"},
	}
	created, err := store.Execute(context.Background(), request)
	if err != nil || len(created.Memories) != 1 {
		t.Fatalf("seed failed: result=%+v err=%v", created, err)
	}

	correction := request
	correction.RequestID = "memory-mutation-correct"
	correction.Operation = "correct"
	correction.Distillation = nil
	correction.TargetMemoryID = created.Memories[0].ID
	correction.ReplacementSummary = "Corrected fact."
	corrected, err := store.Execute(context.Background(), correction)
	if err != nil || len(corrected.Memories) != 1 || corrected.Memories[0].Summary != "Corrected fact." {
		t.Fatalf("correction failed: result=%+v err=%v", corrected, err)
	}

	deletion := correction
	deletion.RequestID = "memory-mutation-delete"
	deletion.Operation = "delete"
	deletion.ReplacementSummary = ""
	deleted, err := store.Execute(context.Background(), deletion)
	if err != nil || len(deleted.Memories) != 0 {
		t.Fatalf("deletion failed: result=%+v err=%v", deleted, err)
	}
}

func TestFixtureMockStoreKeepsOrganizationsIsolated(t *testing.T) {
	store := newFixtureMockStore()
	request := Request{
		ContractVersion: "agent-memory.v1",
		RequestID:       "fixture-memory-1",
		WorkflowID:      "workflow:org-test:release-1",
		OrganizationID:  "org-test",
		ActorID:         "actor-1",
		Scope:           Scope{IDs: []string{"team-test"}},
		PolicyVersion:   "policy-1",
		Capability:      "test-capability",
		AgentDefinition: "release-investigation.synthesizer@1",
		Operation:       "retrieve",
		MemoryScope:     MemoryScope{AgentDefinition: "release-investigation.synthesizer@1", ProjectID: "project-1"},
	}
	first, err := store.Execute(context.Background(), request)
	if err != nil || len(first.Memories) != 1 {
		t.Fatalf("expected one organization-scoped fixture memory, result=%+v err=%v", first, err)
	}

	request.OrganizationID = "org-avengers"
	request.WorkflowID = "workflow:org-avengers:release-1"
	request.Scope = Scope{IDs: []string{"team-avengers"}}
	second, err := store.Execute(context.Background(), request)
	if err != nil || len(second.Memories) != 1 {
		t.Fatalf("expected one second-organization fixture memory, result=%+v err=%v", second, err)
	}
	if first.Memories[0].ID == second.Memories[0].ID || strings.Contains(second.Memories[0].Summary, "org-test") {
		t.Fatalf("fixture memory crossed organization boundary: first=%+v second=%+v", first.Memories[0], second.Memories[0])
	}
	if strings.Contains(first.Memories[0].Summary, "org-test") || strings.Contains(second.Memories[0].Summary, "org-avengers") {
		t.Fatalf("fixture memory summary leaked an organization identifier: first=%q second=%q", first.Memories[0].Summary, second.Memories[0].Summary)
	}
}

func TestMemoryContractsValidateAtTheRuntimeBoundary(t *testing.T) {
	request := Request{
		ContractVersion: "agent-memory.v1",
		RequestID:       "memory-1",
		WorkflowID:      "workflow:org-1:release-1",
		OrganizationID:  "org-1",
		ActorID:         "actor-1",
		Scope:           Scope{IDs: []string{"team-1"}},
		PolicyVersion:   "policy-1",
		Capability:      "test-capability",
		AgentDefinition: "release-investigation.synthesizer@1",
		Operation:       "retrieve",
		MemoryScope:     MemoryScope{AgentDefinition: "release-investigation.synthesizer@1", ProjectID: "project-1"},
		Query:           "release risk patterns",
		MaxResults:      5,
	}
	if err := ValidateRequest(request); err != nil {
		t.Fatalf("expected memory request to validate: %v", err)
	}

	result := Result{
		ContractVersion: "agent-memory-result.v1",
		RequestID:       request.RequestID,
		Status:          "completed",
		Memories: []Record{{
			ID: "memory-1", AgentDefinition: request.AgentDefinition,
			Summary: "Release investigations often need a QA confirmation.", EvidenceRefs: []string{"artifact://memory/evidence-1"}, ObservedAt: "2026-08-20T16:00:00Z",
		}},
	}
	if err := ValidateResult(result); err != nil {
		t.Fatalf("expected memory result to validate: %v", err)
	}
}

func TestMemoryRequestRejectsCrossTenantWorkflowAndAgentScopeConfusion(t *testing.T) {
	request := Request{
		ContractVersion: "agent-memory.v1", RequestID: "memory-security-1", WorkflowID: "workflow:org-1:release-1",
		OrganizationID: "org-1", ActorID: "actor-1", Scope: Scope{IDs: []string{"team-1"}}, PolicyVersion: "policy-1",
		Capability: "capability-1", AgentDefinition: "trusted.agent@1", Operation: "retrieve",
		MemoryScope: MemoryScope{AgentDefinition: "trusted.agent@1"}, Query: "release", MaxResults: 5,
	}
	if err := ValidateRequest(request); err != nil {
		t.Fatalf("valid memory request rejected: %v", err)
	}

	tests := []struct {
		name   string
		mutate func(*Request)
	}{
		{name: "cross tenant workflow", mutate: func(request *Request) { request.WorkflowID = "workflow:org-2:release-1" }},
		{name: "agent scope confusion", mutate: func(request *Request) { request.MemoryScope.AgentDefinition = "other.agent@1" }},
		{name: "empty workflow tenant prefix", mutate: func(request *Request) { request.WorkflowID = "release-1" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate := request
			test.mutate(&candidate)
			if err := ValidateRequest(candidate); err == nil {
				t.Fatal("memory request crossed a security boundary")
			}
		})
	}
}

func TestMockStoreCannotMutateAnotherOrganizationScope(t *testing.T) {
	store := NewMockStore()
	seed := Request{
		ContractVersion: "agent-memory.v1", RequestID: "memory-security-seed", WorkflowID: "workflow:org-1:release-1",
		OrganizationID: "org-1", ActorID: "actor-1", Scope: Scope{IDs: []string{"team-1"}}, PolicyVersion: "policy-1",
		Capability: "capability-1", AgentDefinition: "trusted.agent@1", Operation: "distill",
		MemoryScope:  MemoryScope{AgentDefinition: "trusted.agent@1"},
		Distillation: &Distillation{Summary: "Tenant one fact.", EvidenceRefs: []string{"source:1"}, ObservedAt: "2026-08-20T16:00:00Z"},
	}
	created, err := store.Execute(context.Background(), seed)
	if err != nil || len(created.Memories) != 1 {
		t.Fatalf("seed failed: result=%+v err=%v", created, err)
	}

	crossTenant := seed
	crossTenant.RequestID = "memory-security-cross-tenant"
	crossTenant.WorkflowID = "workflow:org-2:release-1"
	crossTenant.OrganizationID = "org-2"
	crossTenant.Operation = "correct"
	crossTenant.Distillation = nil
	crossTenant.TargetMemoryID = created.Memories[0].ID
	crossTenant.ReplacementSummary = "Attacker overwrite."
	if _, err := store.Execute(context.Background(), crossTenant); err == nil {
		t.Fatal("cross-tenant memory correction was accepted")
	}

	check := seed
	check.RequestID = "memory-security-check"
	check.Operation = "retrieve"
	check.Distillation = nil
	check.Query = "Tenant one"
	check.MaxResults = 5
	result, err := store.Execute(context.Background(), check)
	if err != nil || len(result.Memories) != 1 || result.Memories[0].Summary != "Tenant one fact." {
		t.Fatalf("cross-tenant correction mutated the original scope: result=%+v err=%v", result, err)
	}
}

func TestGeneratedRecordsUseProviderMemoryNames(t *testing.T) {
	request := Request{
		RequestID:      "memory-gcp-1",
		OrganizationID: "org-1",
		MemoryScope:    MemoryScope{AgentDefinition: "context.synthesizer@1", ProjectID: "project-1"},
		Distillation:   &Distillation{Summary: "Fallback fact.", EvidenceRefs: []string{"source:1"}, ObservedAt: "2026-08-20T16:00:00Z"},
	}
	operation := &aiplatform.GoogleLongrunningOperation{Response: []byte(`{"generatedMemories":[{"action":"CREATED","memory":{"name":"projects/demo/locations/us-central1/reasoningEngines/engine-1/memories/memory-1","fact":"Provider fact.","scope":{"organization_id":"org-1","agent_definition":"context.synthesizer@1","project_id":"project-1"},"updateTime":"2026-08-20T17:00:00Z"}}]}`)}
	records, err := generatedRecords(operation, request, "projects/demo/locations/us-central1/reasoningEngines/engine-1")
	if err != nil || len(records) != 1 {
		t.Fatalf("expected one generated memory, records=%+v err=%v", records, err)
	}
	if records[0].ID != "projects/demo/locations/us-central1/reasoningEngines/engine-1/memories/memory-1" || records[0].Summary != "Provider fact." || records[0].ObservedAt != "2026-08-20T17:00:00Z" {
		t.Fatalf("provider memory identity was not preserved: %+v", records[0])
	}
}

func TestGeneratedRecordsRejectOutOfScopeProviderMemory(t *testing.T) {
	request := Request{
		RequestID:      "memory-gcp-2",
		OrganizationID: "org-1",
		MemoryScope:    MemoryScope{AgentDefinition: "context.synthesizer@1"},
		Distillation:   &Distillation{Summary: "Fact.", EvidenceRefs: []string{"source:1"}, ObservedAt: "2026-08-20T16:00:00Z"},
	}
	operation := &aiplatform.GoogleLongrunningOperation{Response: []byte(`{"generatedMemories":[{"action":"CREATED","memory":{"name":"projects/demo/locations/us-central1/reasoningEngines/engine-1/memories/memory-2","fact":"Fact.","scope":{"organization_id":"other-org","agent_definition":"context.synthesizer@1"}}}]}`)}
	if _, err := generatedRecords(operation, request, "projects/demo/locations/us-central1/reasoningEngines/engine-1"); err == nil {
		t.Fatal("expected generated memory scope mismatch to fail")
	}
}
