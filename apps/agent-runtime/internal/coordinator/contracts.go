package coordinator

import contracts "github.com/andriishupta/encois/packages/contracts"

const (
	CoordinatorWorkflowName                 = string(contracts.WorkflowTypeCoordinator)
	BootstrapProjectWorkflowName            = string(contracts.WorkflowTypeBootstrapProject)
	CoordinatorContractVersion              = string(contracts.ContractCoordinator)
	BootstrapProjectContractVersion         = string(contracts.ContractBootstrapProject)
	DynamicWorkflowType                     = string(contracts.WorkflowTypeDynamic)
	SignalIntegrationConnected              = string(contracts.SignalIntegrationConnected)
	SignalSourceReady                       = string(contracts.SignalSourceReady)
	SignalReconcile                         = string(contracts.SignalReconcile)
	SignalWorkflowCompleted                 = string(contracts.SignalWorkflowCompleted)
	SignalProviderChanged                   = string(contracts.SignalProviderChanged)
	SignalApprovalResolved                  = string(contracts.SignalApprovalResolved)
	SignalCoordinatorEvent                  = string(contracts.SignalCoordinatorEvent)
	CoordinatorOnboardingStatusActivityName = "UpdateOnboardingStatus"
	CoordinatorStartWorkflowActivityName    = "StartApprovedWorkflow"
	CoordinatorStateQueryName               = "coordinator-state"
)

type ScopeType string

const (
	ScopeOrganization ScopeType = "organization"
	ScopeProject      ScopeType = "project"
)

type CoordinatorStatus string

const (
	StatusCreated       CoordinatorStatus = "CREATED"
	StatusOnboarding    CoordinatorStatus = "ONBOARDING"
	StatusBootstrapping CoordinatorStatus = "BOOTSTRAPPING"
	StatusReady         CoordinatorStatus = "READY"
	StatusReconciling   CoordinatorStatus = "RECONCILING"
	StatusWaiting       CoordinatorStatus = "WAITING"
	StatusSuspended     CoordinatorStatus = "SUSPENDED"
)

type CoordinatorScope struct {
	IDs []string `json:"ids"`
}

type CoordinatorStartInput struct {
	ContractVersion      string           `json:"contractVersion"`
	CoordinatorID        string           `json:"coordinatorId"`
	OrganizationID       string           `json:"organizationId"`
	ProjectID            string           `json:"projectId,omitempty"`
	ScopeType            ScopeType        `json:"scopeType"`
	Scope                CoordinatorScope `json:"scope"`
	ActorID              string           `json:"actorId,omitempty"`
	PolicyVersion        string           `json:"policyVersion"`
	CoordinationMode     string           `json:"coordinationMode,omitempty"`
	SelectedWorkflowRefs []string         `json:"selectedWorkflowRefs,omitempty"`
	State                CoordinatorState `json:"state"`
}

type CoordinatorState struct {
	Status                  CoordinatorStatus `json:"status"`
	Version                 int               `json:"version"`
	OnboardingComplete      bool              `json:"onboardingComplete"`
	ConnectedIntegrationIDs []string          `json:"connectedIntegrationIds,omitempty"`
	ActiveWorkflowIDs       []string          `json:"activeWorkflowIds,omitempty"`
	ProcessedEventIDs       []string          `json:"processedEventIds,omitempty"`
	ProcessedSignalIDs      []string          `json:"processedSignalIds,omitempty"`
	MemoryVersion           string            `json:"memoryVersion,omitempty"`
	LastEvent               string            `json:"lastEvent,omitempty"`
	LastError               string            `json:"lastError,omitempty"`
	ReconciliationCount     int               `json:"reconciliationCount"`
}

type CoordinatorSignal struct {
	ContractVersion string   `json:"contractVersion"`
	EventID         string   `json:"eventId"`
	SourceID        string   `json:"sourceId,omitempty"`
	Provider        string   `json:"provider,omitempty"`
	WorkflowID      string   `json:"workflowId,omitempty"`
	Approved        *bool    `json:"approved,omitempty"`
	References      []string `json:"references,omitempty"`
}

type OnboardingStatusUpdate struct {
	ContractVersion string `json:"contractVersion"`
	CoordinatorID   string `json:"coordinatorId"`
	OrganizationID  string `json:"organizationId"`
	Status          string `json:"status"`
	LastError       string `json:"lastError,omitempty"`
}

type ApprovedWorkflowStartInput struct {
	RequestID        string         `json:"requestId"`
	CoordinatorID    string         `json:"coordinatorId"`
	OrganizationID   string         `json:"organizationId"`
	ActorID          string         `json:"actorId"`
	PolicyVersion    string         `json:"policyVersion"`
	Scope            map[string]any `json:"scope"`
	BlueprintID      string         `json:"blueprintId"`
	BlueprintVersion string         `json:"blueprintVersion"`
	Key              string         `json:"key"`
	BusinessInput    map[string]any `json:"businessInput,omitempty"`
	IdempotencyKey   string         `json:"idempotencyKey"`
}

type ApprovedWorkflowStartResult struct {
	WorkflowID string `json:"workflowId"`
	RunID      string `json:"runId,omitempty"`
	Status     string `json:"status"`
}

// CoordinatorEvent is the cross-language lifecycle envelope used to notify a
// long-lived Coordinator. It carries observed lifecycle data only.
type CoordinatorEvent struct {
	ContractVersion  string         `json:"contractVersion"`
	EventID          string         `json:"eventId"`
	EventType        string         `json:"eventType"`
	CoordinatorID    string         `json:"coordinatorId"`
	OrganizationID   string         `json:"organizationId"`
	ActorID          string         `json:"actorId,omitempty"`
	Approved         *bool          `json:"approved,omitempty"`
	BlueprintID      string         `json:"blueprintId,omitempty"`
	BlueprintVersion string         `json:"blueprintVersion,omitempty"`
	WorkflowID       string         `json:"workflowId,omitempty"`
	Key              string         `json:"key,omitempty"`
	BusinessInput    map[string]any `json:"businessInput,omitempty"`
	Scope            map[string]any `json:"scope,omitempty"`
	Reason           string         `json:"reason,omitempty"`
	EvidenceRefs     []string       `json:"evidenceRefs,omitempty"`
}

type BootstrapProjectInput struct {
	ContractVersion string `json:"contractVersion"`
	CoordinatorID   string `json:"coordinatorId"`
	OrganizationID  string `json:"organizationId"`
	ProjectID       string `json:"projectId,omitempty"`
	PolicyVersion   string `json:"policyVersion"`
}

type BootstrapProjectResult struct {
	ContractVersion string   `json:"contractVersion"`
	Ready           bool     `json:"ready"`
	EvidenceRefs    []string `json:"evidenceRefs,omitempty"`
	MemoryVersion   string   `json:"memoryVersion,omitempty"`
}

type WorkflowBlueprint struct {
	ContractVersion  string            `json:"contractVersion"`
	BlueprintID      string            `json:"blueprintId"`
	Version          string            `json:"version"`
	Name             string            `json:"name"`
	WorkflowType     string            `json:"workflowType"`
	Purpose          string            `json:"purpose"`
	Enabled          bool              `json:"enabled"`
	Steps            []WorkflowStep    `json:"steps,omitempty"`
	AllowedTools     []string          `json:"allowedTools,omitempty"`
	RequiredScopes   []string          `json:"requiredScopes,omitempty"`
	Parameters       map[string]string `json:"parameters,omitempty"`
	InputSchemaRef   string            `json:"inputSchemaRef,omitempty"`
	OutputSchemaRef  string            `json:"outputSchemaRef,omitempty"`
	RequiresApproval bool              `json:"requiresApproval"`
}

type WorkflowStep struct {
	ID               string                     `json:"id"`
	Kind             contracts.WorkflowStepKind `json:"kind"`
	Tool             string                     `json:"tool,omitempty"`
	AgentDefinition  string                     `json:"agentDefinition,omitempty"`
	DependsOn        []string                   `json:"dependsOn,omitempty"`
	Input            map[string]any             `json:"input,omitempty"`
	RequiresApproval bool                       `json:"requiresApproval,omitempty"`
}
