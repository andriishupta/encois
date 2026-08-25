package memory

import (
	"context"
	"fmt"
	"os"
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
	ContractVersion    string        `json:"contractVersion"`
	RequestID          string        `json:"requestId"`
	TraceID            string        `json:"traceId,omitempty"`
	WorkflowID         string        `json:"workflowId"`
	RunID              string        `json:"runId,omitempty"`
	OrganizationID     string        `json:"organizationId"`
	ActorID            string        `json:"actorId"`
	Scope              Scope         `json:"scope"`
	PolicyVersion      string        `json:"policyVersion"`
	Capability         string        `json:"capability"`
	AgentDefinition    string        `json:"agentDefinition"`
	Operation          string        `json:"operation"`
	MemoryScope        MemoryScope   `json:"memoryScope"`
	TargetMemoryID     string        `json:"targetMemoryId,omitempty"`
	ReplacementSummary string        `json:"replacementSummary,omitempty"`
	Query              string        `json:"query,omitempty"`
	MaxResults         int           `json:"maxResults,omitempty"`
	Distillation       *Distillation `json:"distillation,omitempty"`
}

type Record struct {
	ID              string                           `json:"id"`
	AgentDefinition string                           `json:"agentDefinition"`
	ProjectID       string                           `json:"projectId,omitempty"`
	UserID          string                           `json:"userId,omitempty"`
	Summary         string                           `json:"summary"`
	EvidenceRefs    []string                         `json:"evidenceRefs"`
	ObservedAt      string                           `json:"observedAt"`
	Freshness       *contracts.SourceFreshness       `json:"freshness,omitempty"`
	WorkflowID      string                           `json:"workflowId,omitempty"`
	RunID           string                           `json:"runId,omitempty"`
	RetentionClass  contracts.ArtifactRetentionClass `json:"retentionClass,omitempty"`
	RetentionUntil  string                           `json:"retentionUntil,omitempty"`
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
	fixture bool
}

func NewMockStore() *MockStore {
	return &MockStore{records: make(map[string][]Record)}
}

func newFixtureMockStore() *MockStore {
	return &MockStore{records: make(map[string][]Record), fixture: true}
}

func (s *MockStore) Execute(_ context.Context, request Request) (Result, error) {
	key := scopeKey(request)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fixture && request.Operation != "distill" && len(s.records[key]) == 0 {
		s.records[key] = []Record{{
			ID:              fmt.Sprintf("fixture-memory-%s", safeMemoryID(request.OrganizationID, request.MemoryScope.AgentDefinition, request.MemoryScope.ProjectID, request.MemoryScope.UserID)),
			AgentDefinition: request.MemoryScope.AgentDefinition,
			ProjectID:       request.MemoryScope.ProjectID,
			UserID:          request.MemoryScope.UserID,
			Summary:         "Local memory fixture for the selected organization scope. Release context is available for review.",
			EvidenceRefs:    []string{fmt.Sprintf("memory://local/%s/%s", request.OrganizationID, request.MemoryScope.AgentDefinition)},
			ObservedAt:      time.Now().Add(-15 * time.Minute).UTC().Format(time.RFC3339),
			WorkflowID:      request.WorkflowID,
			RunID:           request.RunID,
		}}
	}
	if request.Operation == "distill" && request.Distillation != nil {
		record := Record{
			ID:              fmt.Sprintf("mock-memory-%d", time.Now().UnixNano()),
			AgentDefinition: request.MemoryScope.AgentDefinition,
			ProjectID:       request.MemoryScope.ProjectID,
			UserID:          request.MemoryScope.UserID,
			Summary:         request.Distillation.Summary,
			EvidenceRefs:    append([]string(nil), request.Distillation.EvidenceRefs...),
			ObservedAt:      request.Distillation.ObservedAt,
			WorkflowID:      request.WorkflowID,
			RunID:           request.RunID,
		}
		s.records[key] = append(s.records[key], record)
		return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: "completed", Memories: []Record{record}}, nil
	}
	if request.Operation == "correct" {
		if request.TargetMemoryID == "" || strings.TrimSpace(request.ReplacementSummary) == "" {
			return Result{}, fmt.Errorf("target memory id and replacement summary are required")
		}
		for index := range s.records[key] {
			if s.records[key][index].ID != request.TargetMemoryID {
				continue
			}
			s.records[key][index].Summary = request.ReplacementSummary
			s.records[key][index].ObservedAt = time.Now().UTC().Format(time.RFC3339)
			return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: "completed", Memories: []Record{s.records[key][index]}}, nil
		}
		return Result{}, fmt.Errorf("memory %q was not found in the requested scope", request.TargetMemoryID)
	}
	if request.Operation == "delete" {
		if request.TargetMemoryID == "" {
			return Result{}, fmt.Errorf("target memory id is required")
		}
		filtered := s.records[key][:0]
		for _, record := range s.records[key] {
			if record.ID != request.TargetMemoryID {
				filtered = append(filtered, record)
			}
		}
		s.records[key] = filtered
		return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: "completed", Memories: []Record{}}, nil
	}
	if request.Operation != "retrieve" {
		return Result{}, fmt.Errorf("unsupported memory operation %q", request.Operation)
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

func safeMemoryID(parts ...string) string {
	value := strings.Join(parts, "-")
	value = strings.NewReplacer("/", "-", ":", "-", " ", "-").Replace(value)
	if value == "" {
		return "default"
	}
	return value
}

func NewStore(ctx context.Context, mode, reasoningEngine string) (Store, func() error, error) {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "mock":
		if strings.EqualFold(strings.TrimSpace(os.Getenv("AGENT_MEMORY_FIXTURE")), "local") {
			return newFixtureMockStore(), func() error { return nil }, nil
		}
		return NewMockStore(), func() error { return nil }, nil
	case "gcp", "vertex", "memory-bank":
		store, err := NewGCPStore(ctx, reasoningEngine)
		return store, func() error { return nil }, err
	default:
		return nil, nil, fmt.Errorf("unsupported agent memory mode %q", mode)
	}
}

func ValidateRequest(request Request) error {
	if err := contractschemaValidate(contracts.SchemaAgentMemory, request); err != nil {
		return err
	}
	if request.AgentDefinition != request.MemoryScope.AgentDefinition {
		return fmt.Errorf("agent definition does not match memory scope")
	}
	if !workflowIDBelongsToOrganization(request.WorkflowID, request.OrganizationID) {
		return fmt.Errorf("workflow id is outside the organization scope")
	}
	return nil
}

func ValidateResult(result Result) error {
	return contractschemaValidate(contracts.SchemaAgentMemoryResult, result)
}

func contractschemaValidate(schema contracts.SchemaName, value any) error {
	return contracts.Validate(schema, value)
}

func workflowIDBelongsToOrganization(workflowID, organizationID string) bool {
	return organizationID != "" && (strings.HasPrefix(workflowID, "org:"+organizationID+":") ||
		strings.HasPrefix(workflowID, "workflow:"+organizationID+":"))
}
