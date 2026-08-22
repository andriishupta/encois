package workflows

import (
	"context"
	"testing"

	contracts "github.com/andriishupta/encois/packages/contracts"
)

func TestSourceIngestionContractAndMockPipelineResult(t *testing.T) {
	input := SourceIngestionWorkflowInput{
		ContractVersion:  string(contracts.ContractSourceIngestion),
		RequestID:        "request-1",
		WorkflowID:       "workflow:org-1:source:revision",
		OrganizationID:   "org-1",
		ActorID:          "actor-1",
		PolicyVersion:    "policy-1",
		Capability:       "test-capability",
		Scope:            map[string]any{"ids": []string{"project-1"}},
		SourceID:         "source-1",
		SourceRevisionID: "revision-1",
		SourceKind:       contracts.SourceKindUploadedDocument,
		ArtifactRef:      "artifact://memory/source-1/revision-1",
		ContentType:      "text/markdown",
		Trigger:          contracts.IngestionTriggerManual,
		ReadScope:        map[string]any{"ids": []string{"project-1"}},
		VisibilityScope:  map[string]any{"ids": []string{"project-1"}},
	}

	if err := ValidateSourceIngestionContract(context.Background(), input); err != nil {
		t.Fatalf("expected valid source ingestion contract: %v", err)
	}
	result, err := ProcessSourceRevision(context.Background(), input)
	if err != nil {
		t.Fatalf("process source revision: %v", err)
	}
	if result.Status != contracts.IngestionStatusCompleted || result.Stage != "memory_distilled" || result.FactsCount == 0 {
		t.Fatalf("expected completed ingestion result, got %+v", result)
	}
	if err := ValidateSourceIngestionResult(context.Background(), result); err != nil {
		t.Fatalf("expected valid source ingestion result: %v", err)
	}
}

func TestSourceIngestionContractRejectsEmptyScope(t *testing.T) {
	input := SourceIngestionWorkflowInput{
		ContractVersion:  string(contracts.ContractSourceIngestion),
		RequestID:        "request-1",
		WorkflowID:       "workflow:org-1:source:revision",
		OrganizationID:   "org-1",
		ActorID:          "actor-1",
		PolicyVersion:    "policy-1",
		Scope:            map[string]any{"ids": []string{}},
		SourceID:         "source-1",
		SourceRevisionID: "revision-1",
		SourceKind:       contracts.SourceKindManual,
		Trigger:          contracts.IngestionTriggerManual,
		ReadScope:        map[string]any{"ids": []string{}},
		VisibilityScope:  map[string]any{"ids": []string{}},
	}

	if err := ValidateSourceIngestionContract(context.Background(), input); err == nil {
		t.Fatal("expected empty source scope to be rejected")
	}
}

func TestSourceIngestionWorkflowRejectsCrossOrganizationWorkflowID(t *testing.T) {
	err := validateSourceIngestionWorkflowInput(SourceIngestionWorkflowInput{
		ContractVersion:  string(contracts.ContractSourceIngestion),
		RequestID:        "request-cross-organization",
		WorkflowID:       "workflow:org-2:source:revision",
		OrganizationID:   "org-1",
		ActorID:          "actor-1",
		PolicyVersion:    "policy-1",
		Capability:       "test-capability",
		SourceID:         "source-1",
		SourceRevisionID: "revision-1",
		SourceKind:       contracts.SourceKindManual,
		Trigger:          contracts.IngestionTriggerManual,
	})
	if err == nil {
		t.Fatal("expected workflow id organization mismatch to be rejected")
	}
}
