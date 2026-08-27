package workflows

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/gatewayclient"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/memory"
	contracts "github.com/andriishupta/encois/packages/contracts"
)

type invalidMemoryResultStore struct{}

func (invalidMemoryResultStore) Execute(context.Context, memory.Request) (memory.Result, error) {
	return memory.Result{}, nil
}

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

func TestGatewaySourceModeReadsArtifactAndProjectsGraphWithExplicitEmptyEdges(t *testing.T) {
	var graphPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/artifacts/read":
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write([]byte("release has one blocked task\n"))
		case "/v1/graph/upsert":
			if err := json.NewDecoder(request.Body).Decode(&graphPayload); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"completed"}`))
		default:
			http.NotFound(w, request)
		}
	}))
	defer server.Close()

	activity := NewSourceIngestionActivities(gatewayclient.New(server.URL, "token"), memory.NewMockStore(), "gateway")
	input := SourceIngestionWorkflowInput{
		ContractVersion:  string(contracts.ContractSourceIngestion),
		RequestID:        "request-gateway-source",
		WorkflowID:       "workflow:org-1:source:revision",
		OrganizationID:   "org-1",
		ActorID:          "actor-1",
		PolicyVersion:    "policy-1",
		Capability:       "test-capability",
		Scope:            map[string]any{"ids": []string{"project-1"}},
		SourceID:         "source-1",
		SourceRevisionID: "revision-1",
		SourceKind:       contracts.SourceKindUploadedDocument,
		ArtifactRef:      "gs://bucket/source-1/revision-1.txt",
		ContentType:      "text/plain",
		Provider:         "jira",
		Trigger:          contracts.IngestionTriggerManual,
		ReadScope:        map[string]any{"ids": []string{"project-1"}},
		VisibilityScope:  map[string]any{"ids": []string{"project-1"}},
	}
	result, err := activity.ProcessSourceRevision(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if result.FactsCount != 1 || result.Status != contracts.IngestionStatusCompleted {
		t.Fatalf("unexpected ingestion result: %+v", result)
	}
	if edges, ok := graphPayload["edges"].([]any); !ok || edges == nil {
		t.Fatalf("graph upsert must send an explicit empty edges array: %#v", graphPayload["edges"])
	}
}

func TestGatewaySourceModeFailsWithoutArtifactReference(t *testing.T) {
	activity := NewSourceIngestionActivities(nil, memory.NewMockStore(), "gateway")
	_, err := activity.ProcessSourceRevision(context.Background(), SourceIngestionWorkflowInput{
		ContractVersion:  string(contracts.ContractSourceIngestion),
		RequestID:        "request-gateway-source",
		WorkflowID:       "workflow:org-1:source:revision",
		OrganizationID:   "org-1",
		ActorID:          "actor-1",
		PolicyVersion:    "policy-1",
		Capability:       "test-capability",
		Scope:            map[string]any{"ids": []string{"project-1"}},
		SourceID:         "source-1",
		SourceRevisionID: "revision-1",
		SourceKind:       contracts.SourceKindUploadedDocument,
		Trigger:          contracts.IngestionTriggerManual,
		ReadScope:        map[string]any{"ids": []string{"project-1"}},
		VisibilityScope:  map[string]any{"ids": []string{"project-1"}},
	})
	if err == nil || !strings.Contains(err.Error(), "artifactRef is required for gateway source mode") {
		t.Fatalf("expected strict gateway source failure, got %v", err)
	}
}

func TestSourceIngestionRejectsInvalidMemoryResult(t *testing.T) {
	activity := NewSourceIngestionActivities(nil, invalidMemoryResultStore{}, "mock")
	_, err := activity.ProcessSourceRevision(context.Background(), SourceIngestionWorkflowInput{
		ContractVersion:  string(contracts.ContractSourceIngestion),
		RequestID:        "request-invalid-memory-result",
		WorkflowID:       "workflow:org-1:source:revision",
		OrganizationID:   "org-1",
		ActorID:          "actor-1",
		PolicyVersion:    "policy-1",
		Capability:       "test-capability",
		Scope:            map[string]any{"ids": []string{"project-1"}},
		SourceID:         "source-1",
		SourceRevisionID: "revision-1",
		SourceKind:       contracts.SourceKindManual,
		Trigger:          contracts.IngestionTriggerManual,
		ReadScope:        map[string]any{"ids": []string{"project-1"}},
		VisibilityScope:  map[string]any{"ids": []string{"project-1"}},
	})
	if err == nil || !strings.Contains(err.Error(), "validate source memory result") {
		t.Fatalf("expected invalid memory result to fail closed, got %v", err)
	}
}
