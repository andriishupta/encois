package health

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/memory"
)

func TestHandlerReportsLivenessAndReadiness(t *testing.T) {
	server := &Server{}
	handler := server.Handler()

	live := httptest.NewRecorder()
	handler.ServeHTTP(live, httptest.NewRequest(http.MethodGet, "/health/live", nil))
	if live.Code != http.StatusOK {
		t.Fatalf("live status = %d, want %d", live.Code, http.StatusOK)
	}

	notReady := httptest.NewRecorder()
	handler.ServeHTTP(notReady, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if notReady.Code != http.StatusServiceUnavailable {
		t.Fatalf("not-ready status = %d, want %d", notReady.Code, http.StatusServiceUnavailable)
	}

	server.Ready.Store(true)
	ready := httptest.NewRecorder()
	handler.ServeHTTP(ready, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if ready.Code != http.StatusOK {
		t.Fatalf("ready status = %d, want %d", ready.Code, http.StatusOK)
	}
}

func TestMemoryQueryRequiresServiceAuthAndIsReadOnly(t *testing.T) {
	server := &Server{MemoryStore: memory.NewMockStore(), RuntimeServiceToken: "runtime-token"}
	handler := server.Handler()
	payload := memory.Request{
		ContractVersion: "agent-memory.v1", RequestID: "memory-query", WorkflowID: "workflow:org-1:dashboard-memory:1",
		OrganizationID: "org-1", ActorID: "admin-1", Scope: memory.Scope{IDs: []string{"team-1"}},
		PolicyVersion: "policy-1", Capability: "inspection-capability", AgentDefinition: "context.synthesizer@1",
		Operation: "retrieve", MemoryScope: memory.MemoryScope{AgentDefinition: "context.synthesizer@1"}, Query: "release", MaxResults: 5,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodPost, "/v1/memory/query", bytes.NewReader(encoded)))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}

	readOnly := payload
	readOnly.Operation = "distill"
	readOnlyEncoded, _ := json.Marshal(readOnly)
	readOnlyRequest := httptest.NewRequest(http.MethodPost, "/v1/memory/query", bytes.NewReader(readOnlyEncoded))
	readOnlyRequest.Header.Set("X-Encois-Service-Token", "runtime-token")
	readOnlyResponse := httptest.NewRecorder()
	handler.ServeHTTP(readOnlyResponse, readOnlyRequest)
	if readOnlyResponse.Code != http.StatusBadRequest {
		t.Fatalf("read-only status = %d, want %d", readOnlyResponse.Code, http.StatusBadRequest)
	}

	validRequest := httptest.NewRequest(http.MethodPost, "/v1/memory/query", bytes.NewReader(encoded))
	validRequest.Header.Set("X-Encois-Service-Token", "runtime-token")
	validResponse := httptest.NewRecorder()
	handler.ServeHTTP(validResponse, validRequest)
	if validResponse.Code != http.StatusOK {
		t.Fatalf("valid status = %d, want %d", validResponse.Code, http.StatusOK)
	}

	mutation := payload
	mutation.Operation = "delete"
	mutation.TargetMemoryID = "fixture-memory-1"
	mutation.Query = ""
	mutationEncoded, _ := json.Marshal(mutation)
	mutationRequest := httptest.NewRequest(http.MethodPost, "/v1/memory/mutate", bytes.NewReader(mutationEncoded))
	mutationRequest.Header.Set("X-Encois-Service-Token", "runtime-token")
	mutationResponse := httptest.NewRecorder()
	handler.ServeHTTP(mutationResponse, mutationRequest)
	if mutationResponse.Code != http.StatusOK {
		t.Fatalf("mutation status = %d, want %d", mutationResponse.Code, http.StatusOK)
	}

	addition := payload
	addition.Operation = "distill"
	addition.Query = ""
	addition.TargetMemoryID = ""
	addition.Distillation = &memory.Distillation{
		Summary:      "An approved operator note.",
		EvidenceRefs: []string{"source:source-1:revision-1"},
		ObservedAt:   "2026-08-20T16:00:00Z",
	}
	additionEncoded, _ := json.Marshal(addition)
	additionRequest := httptest.NewRequest(http.MethodPost, "/v1/memory/mutate", bytes.NewReader(additionEncoded))
	additionRequest.Header.Set("X-Encois-Service-Token", "runtime-token")
	additionResponse := httptest.NewRecorder()
	handler.ServeHTTP(additionResponse, additionRequest)
	if additionResponse.Code != http.StatusOK {
		t.Fatalf("addition status = %d, want %d", additionResponse.Code, http.StatusOK)
	}
}
