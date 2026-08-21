package coordinator

import contracts "github.com/andriishupta/encois/packages/contracts"

const (
	CoordinatorWorkflowName       = string(contracts.WorkflowTypeCoordinator)
	BootstrapProjectWorkflowName  = string(contracts.WorkflowTypeBootstrapProject)
	CoordinatorContractVersion    = string(contracts.ContractCoordinator)
	WorkflowChangePlanVersion     = string(contracts.ContractWorkflowChangePlan)
	UserBlueprintWorkflowType     = string(contracts.WorkflowTypeUserBlueprint)
	SignalIntegrationConnected    = string(contracts.SignalIntegrationConnected)
	SignalSourceReady             = string(contracts.SignalSourceReady)
	SignalReconcile               = string(contracts.SignalReconcile)
	SignalWorkflowCompleted       = string(contracts.SignalWorkflowCompleted)
	SignalProviderChanged         = string(contracts.SignalProviderChanged)
	SignalApprovalResolved        = string(contracts.SignalApprovalResolved)
	SignalCoordinatorEvent        = string(contracts.SignalCoordinatorEvent)
	CoordinatorPlanActivityName   = "CreateCoordinatorPlan"
	CoordinatorSubmitActivityName = "SubmitWorkflowChangePlan"
	CoordinatorStartActivityName  = "StartApprovedWorkflow"
	CoordinatorStateQueryName     = "coordinator-state"
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

type CoordinatorStartInput struct {
	ContractVersion string           `json:"contractVersion"`
	CoordinatorID   string           `json:"coordinatorId"`
	OrganizationID  string           `json:"organizationId"`
	ProjectID       string           `json:"projectId,omitempty"`
	ScopeType       ScopeType        `json:"scopeType"`
	ActorID         string           `json:"actorId,omitempty"`
	PolicyVersion   string           `json:"policyVersion"`
	State           CoordinatorState `json:"state"`
}

type CoordinatorState struct {
	Status                  CoordinatorStatus   `json:"status"`
	Version                 int                 `json:"version"`
	OnboardingComplete      bool                `json:"onboardingComplete"`
	ConnectedIntegrationIDs []string            `json:"connectedIntegrationIds,omitempty"`
	ActiveWorkflowIDs       []string            `json:"activeWorkflowIds,omitempty"`
	PendingPlanIDs          []string            `json:"pendingPlanIds,omitempty"`
	PendingWorkflowStarts   []WorkflowStartSpec `json:"pendingWorkflowStarts,omitempty"`
	ProcessedEventIDs       []string            `json:"processedEventIds,omitempty"`
	MemoryVersion           string              `json:"memoryVersion,omitempty"`
	LastEvent               string              `json:"lastEvent,omitempty"`
	ReconciliationCount     int                 `json:"reconciliationCount"`
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

// CoordinatorEvent is the cross-language lifecycle envelope used to notify a
// long-lived Coordinator. It is intentionally broader than the
// blueprint-approval Signal, which belongs to one generic Workflow step.
type CoordinatorEvent struct {
	ContractVersion  string              `json:"contractVersion"`
	EventID          string              `json:"eventId"`
	EventType        string              `json:"eventType"`
	CoordinatorID    string              `json:"coordinatorId"`
	OrganizationID   string              `json:"organizationId"`
	ActorID          string              `json:"actorId,omitempty"`
	PlanID           string              `json:"planId,omitempty"`
	Approved         *bool               `json:"approved,omitempty"`
	BlueprintID      string              `json:"blueprintId,omitempty"`
	BlueprintVersion string              `json:"blueprintVersion,omitempty"`
	WorkflowID       string              `json:"workflowId,omitempty"`
	Key              string              `json:"key,omitempty"`
	BusinessInput    map[string]any      `json:"businessInput,omitempty"`
	Scope            map[string]any      `json:"scope,omitempty"`
	Reason           string              `json:"reason,omitempty"`
	EvidenceRefs     []string            `json:"evidenceRefs,omitempty"`
	WorkflowStarts   []WorkflowStartSpec `json:"workflowStarts,omitempty"`
}

type WorkflowStartSpec struct {
	BlueprintID      string         `json:"blueprintId"`
	BlueprintVersion string         `json:"blueprintVersion"`
	Key              string         `json:"key"`
	BusinessInput    map[string]any `json:"businessInput,omitempty"`
	Scope            map[string]any `json:"scope,omitempty"`
}

// WorkflowStartIntent is the plan-level request to start the Blueprint that
// belongs to the same change. Blueprint identity is derived from the change;
// it is added only when the applied plan becomes a Coordinator event.
type WorkflowStartIntent struct {
	Key           string         `json:"key"`
	BusinessInput map[string]any `json:"businessInput,omitempty"`
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
	PlanID          string   `json:"planId,omitempty"`
}

// BootstrapPlanActivityResult crosses the Activity boundary without exposing
// raw model output. The Gateway API still owns persistence and approval.
type BootstrapPlanActivityResult struct {
	Status string              `json:"status"`
	Plan   *WorkflowChangePlan `json:"plan,omitempty"`
}

// CoordinatorPlanActivityResult is the typed boundary between a
// reconciliation Workflow and the model-backed planning Activity. It carries
// a validated proposal only; it never carries raw model output.
type CoordinatorPlanActivityResult struct {
	Status string              `json:"status"`
	Plan   *WorkflowChangePlan `json:"plan,omitempty"`
}

// PlanSubmissionResult mirrors the Runtime-facing control-plane response
// without importing the HTTP adapter into deterministic Workflow code.
type PlanSubmissionResult struct {
	PlanID           string   `json:"planId"`
	Accepted         bool     `json:"accepted"`
	RequiresApproval bool     `json:"requiresApproval"`
	Status           string   `json:"status"`
	WorkflowIDs      []string `json:"workflowIds,omitempty"`
}

// ApprovedWorkflowStartInput is the stateless input for the Gateway start
// Activity. The Activity implementation uses the equivalent private adapter
// type; keeping this input in the Coordinator package avoids a dependency from
// deterministic Workflow code to an HTTP integration package.
type ApprovedWorkflowStartInput struct {
	RequestID        string         `json:"requestId"`
	TraceID          string         `json:"traceId,omitempty"`
	CoordinatorID    string         `json:"coordinatorId"`
	OrganizationID   string         `json:"organizationId"`
	ProjectID        string         `json:"projectId,omitempty"`
	ActorID          string         `json:"actorId"`
	PolicyVersion    string         `json:"policyVersion"`
	Scope            map[string]any `json:"scope"`
	BlueprintID      string         `json:"blueprintId"`
	BlueprintVersion string         `json:"blueprintVersion"`
	Key              string         `json:"key"`
	BusinessInput    map[string]any `json:"businessInput,omitempty"`
	IdempotencyKey   string         `json:"idempotencyKey,omitempty"`
}

type ApprovedWorkflowStartResult struct {
	WorkflowID string `json:"workflowId"`
	RunID      string `json:"runId,omitempty"`
	Status     string `json:"status"`
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

type WorkflowChangeKind = contracts.WorkflowChangeKind

const (
	ChangeCreate    = contracts.ChangeCreate
	ChangeUpdate    = contracts.ChangeUpdate
	ChangeDeprecate = contracts.ChangeDeprecate
	ChangeCancel    = contracts.ChangeCancel
)

type WorkflowChange struct {
	Kind                   WorkflowChangeKind   `json:"kind"`
	TargetBlueprintID      string               `json:"targetBlueprintId,omitempty"`
	TargetBlueprintVersion string               `json:"targetBlueprintVersion,omitempty"`
	TargetWorkflowID       string               `json:"targetWorkflowId,omitempty"`
	Blueprint              *WorkflowBlueprint   `json:"blueprint,omitempty"`
	Start                  *WorkflowStartIntent `json:"start,omitempty"`
	Reason                 string               `json:"reason"`
	EvidenceRefs           []string             `json:"evidenceRefs,omitempty"`
	RequiresApproval       bool                 `json:"requiresApproval"`
}

type WorkflowChangePlan struct {
	ContractVersion string           `json:"contractVersion"`
	PlanID          string           `json:"planId"`
	CoordinatorID   string           `json:"coordinatorId"`
	OrganizationID  string           `json:"organizationId"`
	ProjectID       string           `json:"projectId,omitempty"`
	ObservedAt      string           `json:"observedAt"`
	EvidenceRefs    []string         `json:"evidenceRefs,omitempty"`
	Changes         []WorkflowChange `json:"changes"`
}
