package memory

import (
	"context"
	"errors"
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

func TestDeferredStoreDoesNotPretendMemoryIsAvailable(t *testing.T) {
	_, err := (DeferredStore{}).Execute(context.Background(), Request{})
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
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
