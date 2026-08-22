package memory

import (
	"context"
	"strings"
	"testing"
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
