package memory

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	contracts "github.com/andriishupta/encois/packages/contracts"
)

type Scope struct {
	IDs []string `json:"ids"`
}

type MemoryScope struct {
	AgentDefinition string `json:"agentDefinition"`
	ProjectID       string `json:"projectId,omitempty"`
	UserID          string `json:"userId,omitempty"`
}

type Distillation struct {
	Summary          string                          `json:"summary"`
	EvidenceRefs     []string                        `json:"evidenceRefs"`
	ObservedAt       string                          `json:"observedAt"`
	RedactionStatus  contracts.MemoryRedactionStatus `json:"redactionStatus,omitempty"`
	RedactionVersion string                          `json:"redactionVersion,omitempty"`
}

type Request struct {
	ContractVersion string        `json:"contractVersion"`
	RequestID       string        `json:"requestId"`
	TraceID         string        `json:"traceId,omitempty"`
	WorkflowID      string        `json:"workflowId"`
	RunID           string        `json:"runId,omitempty"`
	OrganizationID  string        `json:"organizationId"`
	ActorID         string        `json:"actorId"`
	Scope           Scope         `json:"scope"`
	PolicyVersion   string        `json:"policyVersion"`
	Capability      string        `json:"capability"`
	AgentDefinition string        `json:"agentDefinition"`
	Operation       string        `json:"operation"`
	MemoryScope     MemoryScope   `json:"memoryScope"`
	Query           string        `json:"query,omitempty"`
	MaxResults      int           `json:"maxResults,omitempty"`
	Distillation    *Distillation `json:"distillation,omitempty"`
}

type Record struct {
	ID              string                     `json:"id"`
	AgentDefinition string                     `json:"agentDefinition"`
	Summary         string                     `json:"summary"`
	EvidenceRefs    []string                   `json:"evidenceRefs"`
	ObservedAt      string                     `json:"observedAt"`
	Freshness       *contracts.SourceFreshness `json:"freshness,omitempty"`
}

type Result struct {
	ContractVersion string   `json:"contractVersion"`
	RequestID       string   `json:"requestId"`
	Status          string   `json:"status"`
	Memories        []Record `json:"memories"`
}

// Store is the Activity-side boundary for agent-specific semantic memory.
// Implementations must enforce organization, hierarchy, agent, and optional
// user scope again at the provider boundary.
type Store interface {
	Execute(context.Context, Request) (Result, error)
}

type MockStore struct {
	mu      sync.RWMutex
	records map[string][]Record
}

func NewMockStore() *MockStore {
	return &MockStore{records: make(map[string][]Record)}
}

func (s *MockStore) Execute(_ context.Context, request Request) (Result, error) {
	key := scopeKey(request)
	s.mu.Lock()
	defer s.mu.Unlock()
	if request.Operation == "distill" && request.Distillation != nil {
		record := Record{
			ID:              fmt.Sprintf("mock-memory-%d", time.Now().UnixNano()),
			AgentDefinition: request.MemoryScope.AgentDefinition,
			Summary:         request.Distillation.Summary,
			EvidenceRefs:    append([]string(nil), request.Distillation.EvidenceRefs...),
			ObservedAt:      request.Distillation.ObservedAt,
		}
		s.records[key] = append(s.records[key], record)
		return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: "completed", Memories: []Record{record}}, nil
	}
	records := append([]Record(nil), s.records[key]...)
	if request.Query != "" {
		filtered := records[:0]
		for _, record := range records {
			if strings.Contains(strings.ToLower(record.Summary), strings.ToLower(request.Query)) {
				filtered = append(filtered, record)
			}
		}
		records = filtered
	}
	if request.MaxResults > 0 && len(records) > request.MaxResults {
		records = records[len(records)-request.MaxResults:]
	}
	return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: "completed", Memories: records}, nil
}

func scopeKey(request Request) string {
	return strings.Join([]string{request.OrganizationID, request.MemoryScope.AgentDefinition, request.MemoryScope.ProjectID, request.MemoryScope.UserID}, "\x00")
}

func NewStore(ctx context.Context, mode, reasoningEngine string) (Store, func() error, error) {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "mock":
		return NewMockStore(), func() error { return nil }, nil
	case "gcp", "vertex", "memory-bank":
		store, err := NewGCPStore(ctx, reasoningEngine)
		return store, func() error { return nil }, err
	default:
		return nil, nil, fmt.Errorf("unsupported agent memory mode %q", mode)
	}
}

func ValidateRequest(request Request) error {
	return contractschemaValidate(contracts.SchemaAgentMemory, request)
}

func ValidateResult(result Result) error {
	return contractschemaValidate(contracts.SchemaAgentMemoryResult, result)
}

func contractschemaValidate(schema contracts.SchemaName, value any) error {
	return contracts.Validate(schema, value)
}
