package memory

import (
	"context"
	"errors"

	contractschemas "github.com/andriishupta/encois/packages/contracts"
)

// ErrNotConfigured is returned until a hosted Memory Bank adapter is selected
// and configured. The Workflow should treat it as a deferred capability, not
// as an empty successful memory result.
var ErrNotConfigured = errors.New("agent memory store is not configured")

type Scope struct {
	IDs        []string `json:"ids"`
	TeamIDs    []string `json:"teamIds,omitempty"`
	ProjectIDs []string `json:"projectIds,omitempty"`
}

type MemoryScope struct {
	AgentDefinition string `json:"agentDefinition"`
	ProjectID       string `json:"projectId,omitempty"`
	UserID          string `json:"userId,omitempty"`
}

type Distillation struct {
	Summary      string   `json:"summary"`
	EvidenceRefs []string `json:"evidenceRefs"`
	ObservedAt   string   `json:"observedAt"`
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
	AgentDefinition string        `json:"agentDefinition"`
	Operation       string        `json:"operation"`
	MemoryScope     MemoryScope   `json:"memoryScope"`
	Query           string        `json:"query,omitempty"`
	MaxResults      int           `json:"maxResults,omitempty"`
	Distillation    *Distillation `json:"distillation,omitempty"`
}

type Record struct {
	ID              string   `json:"id"`
	AgentDefinition string   `json:"agentDefinition"`
	Summary         string   `json:"summary"`
	EvidenceRefs    []string `json:"evidenceRefs"`
	ObservedAt      string   `json:"observedAt"`
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

type DeferredStore struct{}

func (DeferredStore) Execute(context.Context, Request) (Result, error) {
	return Result{}, ErrNotConfigured
}

func ValidateRequest(request Request) error {
	return contractschemaValidate(contractschemas.SchemaAgentMemory, request)
}

func ValidateResult(result Result) error {
	return contractschemaValidate(contractschemas.SchemaAgentMemoryResult, result)
}

func contractschemaValidate(schema contractschemas.SchemaName, value any) error {
	return contractschemas.Validate(schema, value)
}
