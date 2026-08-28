package contracts

import "strings"

// ContractVersion identifies a versioned wire boundary shared by the
// TypeScript API and Go services.
type ContractVersion string

const (
	ContractExecutionContext      ContractVersion = "execution-context.v1"
	ContractWorkflowBlueprint     ContractVersion = "workflow-blueprint.v1"
	ContractWorkflowResult        ContractVersion = "blueprint-workflow-result.v1"
	ContractAgentResult           ContractVersion = "agent-result.v1"
	ContractAgentInstructions     ContractVersion = "agent-instructions.v1"
	ContractWorkflowSignal        ContractVersion = "workflow-signal.v1"
	ContractToolRequest           ContractVersion = "tool-request.v1"
	ContractToolResult            ContractVersion = "tool-result.v1"
	ContractArtifactWrite         ContractVersion = "artifact-write.v1"
	ContractArtifactRead          ContractVersion = "artifact-read.v1"
	ContractArtifactWriteResult   ContractVersion = "artifact-write-result.v1"
	ContractGraphQuery            ContractVersion = "graph-query.v1"
	ContractGraphUpsert           ContractVersion = "graph-upsert.v1"
	ContractGraphQueryResult      ContractVersion = "graph-query-result.v1"
	ContractAgentMemory           ContractVersion = "agent-memory.v1"
	ContractAgentMemoryResult     ContractVersion = "agent-memory-result.v1"
	ContractToolManifest          ContractVersion = "tool-manifest.v1"
	ContractWorkflowUpdate        ContractVersion = "workflow-update.v1"
	ContractCoordinatorEvent      ContractVersion = "coordinator-event.v1"
	ContractCoordinator           ContractVersion = "coordinator.v1"
	ContractBootstrapProject      ContractVersion = "bootstrap-project.v1"
	ContractKnowledgeSource       ContractVersion = "knowledge-source.v1"
	ContractSourceRevision        ContractVersion = "source-revision.v1"
	ContractSourceIngestion       ContractVersion = "source-ingestion.v1"
	ContractSourceIngestionResult ContractVersion = "source-ingestion-result.v1"
)

type TemporalWorkflowType string

const (
	WorkflowTypeDynamic          TemporalWorkflowType = "encois.dynamic.v1"
	WorkflowTypeCoordinator      TemporalWorkflowType = "CoordinatorWorkflow"
	WorkflowTypeBootstrapProject TemporalWorkflowType = "BootstrapProjectWorkflow"
	WorkflowTypeSourceIngestion  TemporalWorkflowType = "encois.source-ingestion.v1"
)

type WorkflowStepKind string

const (
	StepKindTool      WorkflowStepKind = "tool"
	StepKindAgent     WorkflowStepKind = "agent"
	StepKindTransform WorkflowStepKind = "transform"
	StepKindCondition WorkflowStepKind = "condition"
	StepKindWait      WorkflowStepKind = "wait"
	StepKindApproval  WorkflowStepKind = "approval"
)

// DefaultAgentDefinition is the generic synthesis role used by the current
// workflow templates and Blueprint definitions.
const DefaultAgentDefinition = "context.synthesizer@1"

// RegisteredAgentDefinitions is the shared semantic allowlist for executable
// Blueprint agent steps. It is intentionally separate from provider tools and
// workflow/template keys.
var RegisteredAgentDefinitions = map[string]struct{}{
	"context.summarizer.v1":               {},
	"context.summarizer@1":                {},
	DefaultAgentDefinition:                {},
	"context.synthesizer.v1":              {},
	"release-investigation.synthesizer@1": {},
}

func IsRegisteredAgentDefinition(value string) bool {
	_, ok := RegisteredAgentDefinitions[strings.TrimSpace(value)]
	return ok
}

type WorkflowSignalName string

const SignalBlueprintApproval WorkflowSignalName = "blueprint-approval"
const SignalWorkflowPause WorkflowSignalName = "workflow-pause"
const SignalWorkflowResume WorkflowSignalName = "workflow-resume"

type WorkflowUpdateName string

const UpdateBlueprintContext WorkflowUpdateName = "blueprint-context"

type ToolResultStatus string

const (
	ToolStatusCompleted ToolResultStatus = "completed"
	ToolStatusWaiting   ToolResultStatus = "waiting"
	ToolStatusFailed    ToolResultStatus = "failed"
)

type WorkflowResultStatus string

const (
	WorkflowResultCompleted WorkflowResultStatus = "completed"
	WorkflowResultWaiting   WorkflowResultStatus = "waiting"
	WorkflowResultFailed    WorkflowResultStatus = "failed"
	WorkflowResultPartial   WorkflowResultStatus = "partial"
)

type WorkflowExecutionStatus string

const (
	WorkflowExecutionQueued    WorkflowExecutionStatus = "queued"
	WorkflowExecutionRunning   WorkflowExecutionStatus = "running"
	WorkflowExecutionWaiting   WorkflowExecutionStatus = "waiting"
	WorkflowExecutionPaused    WorkflowExecutionStatus = "paused"
	WorkflowExecutionPartial   WorkflowExecutionStatus = "partial"
	WorkflowExecutionFailed    WorkflowExecutionStatus = "failed"
	WorkflowExecutionCompleted WorkflowExecutionStatus = "completed"
	WorkflowExecutionCancelled WorkflowExecutionStatus = "cancelled"
)

type AgentResultStatus string

const (
	AgentResultSuccess     AgentResultStatus = "success"
	AgentResultPartial     AgentResultStatus = "partial"
	AgentResultFailure     AgentResultStatus = "failure"
	AgentResultNoEvidence  AgentResultStatus = "no_evidence"
	AgentResultNoSources   AgentResultStatus = "no_sources"
	AgentResultNeedsReview AgentResultStatus = "needs_review"
)

type AgentEvidence struct {
	Reference string `json:"reference"`
	Claim     string `json:"claim"`
}

type AgentResult struct {
	ContractVersion ContractVersion   `json:"contractVersion"`
	Status          AgentResultStatus `json:"status"`
	Summary         string            `json:"summary"`
	Sources         []string          `json:"sources"`
	Evidence        []AgentEvidence   `json:"evidence"`
	Warnings        []string          `json:"warnings"`
	Data            map[string]any    `json:"data,omitempty"`
}

type AgentInstructions struct {
	ContractVersion ContractVersion `json:"contractVersion"`
	Role            string          `json:"role"`
	OutputContract  string          `json:"outputContract"`
	Must            []string        `json:"must"`
	MustNot         []string        `json:"mustNot"`
	InputExample    map[string]any  `json:"inputExample"`
	OutputExample   map[string]any  `json:"outputExample"`
}

type GraphQueryStatus string

const (
	GraphStatusCompleted GraphQueryStatus = "completed"
	GraphStatusDeferred  GraphQueryStatus = "deferred"
	GraphStatusFailed    GraphQueryStatus = "failed"
)

type AgentMemoryOperation string

const (
	MemoryOperationRetrieve AgentMemoryOperation = "retrieve"
	MemoryOperationDistill  AgentMemoryOperation = "distill"
	MemoryOperationCorrect  AgentMemoryOperation = "correct"
	MemoryOperationDelete   AgentMemoryOperation = "delete"
)

type AgentMemoryStatus string

const (
	MemoryStatusCompleted AgentMemoryStatus = "completed"
	MemoryStatusDeferred  AgentMemoryStatus = "deferred"
	MemoryStatusFailed    AgentMemoryStatus = "failed"
)

type ToolSideEffects string

const (
	SideEffectsReadOnly      ToolSideEffects = "read-only"
	SideEffectsExternalWrite ToolSideEffects = "external-write"
)

type CoordinatorEventType string

const (
	EventWorkflowCompleted    CoordinatorEventType = "workflow-completed"
	EventIntegrationConnected CoordinatorEventType = "integration-connected"
	EventSourceReady          CoordinatorEventType = "source-ready"
	EventReconcileRequested   CoordinatorEventType = "reconcile-requested"
	EventProviderChanged      CoordinatorEventType = "provider-changed"
)

type CoordinatorSignalName string

const (
	SignalIntegrationConnected CoordinatorSignalName = "integration-connected"
	SignalSourceReady          CoordinatorSignalName = "source-ready"
	SignalReconcile            CoordinatorSignalName = "reconcile-requested"
	SignalWorkflowCompleted    CoordinatorSignalName = "workflow-completed"
	SignalProviderChanged      CoordinatorSignalName = "provider-changed"
	SignalApprovalResolved     CoordinatorSignalName = "approval-resolved"
	SignalCoordinatorEvent     CoordinatorSignalName = "coordinator-event"
)

type OrganizationUnitType string

const (
	OrganizationUnitOrganization OrganizationUnitType = "organization"
	OrganizationUnitDepartment   OrganizationUnitType = "department"
	OrganizationUnitTeam         OrganizationUnitType = "team"
	OrganizationUnitProject      OrganizationUnitType = "project"
	OrganizationUnitService      OrganizationUnitType = "service"
	OrganizationUnitCustom       OrganizationUnitType = "custom"
)

type ScopeRuleMode string

const (
	ScopeRuleGrant    ScopeRuleMode = "grant"
	ScopeRuleRestrict ScopeRuleMode = "restrict"
)

type FreshnessStatus string

// WorkflowTrace carries bounded, non-sensitive execution attributes from a
// runtime step to the control plane. It deliberately excludes prompts,
// model reasoning, and raw provider payloads.
type WorkflowTrace struct {
	Provider   string `json:"provider,omitempty"`
	Model      string `json:"model,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	Attempt    int32  `json:"attempt,omitempty"`
	Budget     string `json:"budget,omitempty"`
	Outcome    string `json:"outcome,omitempty"`
	Redacted   bool   `json:"redacted,omitempty"`
}

const (
	FreshnessFresh   FreshnessStatus = "fresh"
	FreshnessStale   FreshnessStatus = "stale"
	FreshnessUnknown FreshnessStatus = "unknown"
)

type WorkflowStatusReason string

const (
	ReasonTemporaryError      WorkflowStatusReason = "temporary_error"
	ReasonMissingCredentials  WorkflowStatusReason = "missing_credentials"
	ReasonHumanApproval       WorkflowStatusReason = "human_approval"
	ReasonCapabilityMissing   WorkflowStatusReason = "capability_unavailable"
	ReasonProviderUnavailable WorkflowStatusReason = "provider_unavailable"
	ReasonInvalidInput        WorkflowStatusReason = "invalid_input"
	ReasonDegradedEvidence    WorkflowStatusReason = "degraded_evidence"
)

type ArtifactRetentionClass string

const (
	RetentionEphemeral      ArtifactRetentionClass = "ephemeral"
	RetentionInvestigation  ArtifactRetentionClass = "investigation"
	RetentionSourceSnapshot ArtifactRetentionClass = "source_snapshot"
	RetentionLegalHold      ArtifactRetentionClass = "legal_hold"
)

type MemoryRedactionStatus string

const (
	RedactionApplied  MemoryRedactionStatus = "applied"
	RedactionNoMatch  MemoryRedactionStatus = "no_match"
	RedactionDeferred MemoryRedactionStatus = "deferred"
)

type IntegrationStatus string

const (
	IntegrationPending     IntegrationStatus = "pending"
	IntegrationAuthorized  IntegrationStatus = "authorized"
	IntegrationActive      IntegrationStatus = "active"
	IntegrationDegraded    IntegrationStatus = "degraded"
	IntegrationNeedsReauth IntegrationStatus = "needs_reauth"
	IntegrationDisabled    IntegrationStatus = "disabled"
	IntegrationError       IntegrationStatus = "error"
)

type KnowledgeSourceKind string

const (
	SourceKindIntegration      KnowledgeSourceKind = "integration"
	SourceKindUploadedDocument KnowledgeSourceKind = "uploaded_document"
	SourceKindManual           KnowledgeSourceKind = "manual"
	SourceKindMedia            KnowledgeSourceKind = "media"
)

type KnowledgeSourceStatus string

const (
	SourceStatusDraft       KnowledgeSourceStatus = "draft"
	SourceStatusConnecting  KnowledgeSourceStatus = "connecting"
	SourceStatusDiscovering KnowledgeSourceStatus = "discovering"
	SourceStatusIngesting   KnowledgeSourceStatus = "ingesting"
	SourceStatusActive      KnowledgeSourceStatus = "active"
	SourceStatusDegraded    KnowledgeSourceStatus = "degraded"
	SourceStatusNeedsReauth KnowledgeSourceStatus = "needs_reauth"
	SourceStatusFailed      KnowledgeSourceStatus = "failed"
	SourceStatusDisabled    KnowledgeSourceStatus = "disabled"
)

type SourceRevisionStatus string

const (
	RevisionStatusPending    SourceRevisionStatus = "pending"
	RevisionStatusIngesting  SourceRevisionStatus = "ingesting"
	RevisionStatusActive     SourceRevisionStatus = "active"
	RevisionStatusFailed     SourceRevisionStatus = "failed"
	RevisionStatusSuperseded SourceRevisionStatus = "superseded"
)

type SourceIngestionTrigger string

const (
	IngestionTriggerBootstrap SourceIngestionTrigger = "bootstrap"
	IngestionTriggerManual    SourceIngestionTrigger = "manual"
	IngestionTriggerWebhook   SourceIngestionTrigger = "webhook"
	IngestionTriggerSchedule  SourceIngestionTrigger = "schedule"
	IngestionTriggerReconcile SourceIngestionTrigger = "reconcile"
)

type SourceIngestionStatus string

const (
	IngestionStatusCompleted SourceIngestionStatus = "completed"
	IngestionStatusDeferred  SourceIngestionStatus = "deferred"
	IngestionStatusFailed    SourceIngestionStatus = "failed"
)

type SourceFreshness struct {
	Source     string          `json:"source"`
	ObservedAt string          `json:"observedAt"`
	IngestedAt string          `json:"ingestedAt,omitempty"`
	ExpiresAt  string          `json:"expiresAt,omitempty"`
	Status     FreshnessStatus `json:"status"`
}

type DataProvenance struct {
	Source                string         `json:"source"`
	SourceID              string         `json:"sourceId,omitempty"`
	SourceRevisionID      string         `json:"sourceRevisionId,omitempty"`
	SourceRecordID        string         `json:"sourceRecordId,omitempty"`
	ArtifactRef           string         `json:"artifactRef,omitempty"`
	Locator               map[string]any `json:"locator,omitempty"`
	ObservedAt            string         `json:"observedAt"`
	IngestedAt            string         `json:"ingestedAt,omitempty"`
	TransformationVersion string         `json:"transformationVersion,omitempty"`
	VisibilityScope       []string       `json:"visibilityScope,omitempty"`
}
