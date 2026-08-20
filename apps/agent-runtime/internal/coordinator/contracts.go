package coordinator

const (
	CoordinatorWorkflowName      = "CoordinatorWorkflow"
	BootstrapProjectWorkflowName = "BootstrapProjectWorkflow"
	CoordinatorContractVersion   = "coordinator.v1"
	WorkflowChangePlanVersion    = "workflow-change-plan.v1"
	UserBlueprintWorkflowType    = "encois.user-blueprint.v1"
	SignalIntegrationConnected   = "integration-connected"
	SignalSourceReady            = "source-ready"
	SignalReconcile              = "reconcile-requested"
	SignalWorkflowCompleted      = "workflow-completed"
	SignalProviderChanged        = "provider-changed"
	SignalApprovalResolved       = "approval-resolved"
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
	Status                  CoordinatorStatus `json:"status"`
	Version                 int               `json:"version"`
	OnboardingComplete      bool              `json:"onboardingComplete"`
	ConnectedIntegrationIDs []string          `json:"connectedIntegrationIds,omitempty"`
	ActiveWorkflowIDs       []string          `json:"activeWorkflowIds,omitempty"`
	PendingPlanIDs          []string          `json:"pendingPlanIds,omitempty"`
	MemoryVersion           string            `json:"memoryVersion,omitempty"`
	LastEvent               string            `json:"lastEvent,omitempty"`
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

type ScheduleBlueprint struct {
	Cron          string `json:"cron,omitempty"`
	Timezone      string `json:"timezone,omitempty"`
	OverlapPolicy string `json:"overlapPolicy,omitempty"`
}

type WorkflowBlueprint struct {
	ContractVersion  string             `json:"contractVersion"`
	BlueprintID      string             `json:"blueprintId"`
	Version          string             `json:"version"`
	Name             string             `json:"name"`
	WorkflowType     string             `json:"workflowType"`
	Purpose          string             `json:"purpose"`
	Enabled          bool               `json:"enabled"`
	Steps            []WorkflowStep     `json:"steps,omitempty"`
	AllowedTools     []string           `json:"allowedTools,omitempty"`
	RequiredScopes   []string           `json:"requiredScopes,omitempty"`
	Parameters       map[string]string  `json:"parameters,omitempty"`
	Schedule         *ScheduleBlueprint `json:"schedule,omitempty"`
	RequiresApproval bool               `json:"requiresApproval"`
}

type WorkflowStep struct {
	ID               string         `json:"id"`
	Kind             string         `json:"kind"`
	Tool             string         `json:"tool,omitempty"`
	AgentDefinition  string         `json:"agentDefinition,omitempty"`
	DependsOn        []string       `json:"dependsOn,omitempty"`
	Input            map[string]any `json:"input,omitempty"`
	RequiresApproval bool           `json:"requiresApproval,omitempty"`
}

type WorkflowChangeKind string

const (
	ChangeCreate    WorkflowChangeKind = "create"
	ChangeUpdate    WorkflowChangeKind = "update"
	ChangeDeprecate WorkflowChangeKind = "deprecate"
	ChangeCancel    WorkflowChangeKind = "cancel"
)

type WorkflowChange struct {
	Kind             WorkflowChangeKind `json:"kind"`
	TargetWorkflowID string             `json:"targetWorkflowId,omitempty"`
	Blueprint        WorkflowBlueprint  `json:"blueprint"`
	Reason           string             `json:"reason"`
	EvidenceRefs     []string           `json:"evidenceRefs,omitempty"`
	RequiresApproval bool               `json:"requiresApproval"`
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
