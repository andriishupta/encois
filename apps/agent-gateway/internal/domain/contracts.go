package domain

import (
	"fmt"

	contracts "github.com/andriishupta/encois/packages/contracts"
)

const (
	ToolRequestContractVersion         = string(contracts.ContractToolRequest)
	GraphQueryContractVersion          = string(contracts.ContractGraphQuery)
	GraphQueryResultContractVersion    = string(contracts.ContractGraphQueryResult)
	ArtifactWriteContractVersion       = string(contracts.ContractArtifactWrite)
	ArtifactWriteResultContractVersion = string(contracts.ContractArtifactWriteResult)
	AuthorizationContractVersion       = string(contracts.ContractAuthorizationCheck)
	ToolResultContractVersion          = string(contracts.ContractToolResult)
	ToolManifestContractVersion        = string(contracts.ContractToolManifest)
	WorkflowBlueprintContractVersion   = string(contracts.ContractWorkflowBlueprint)
	WorkflowDefinitionContractVersion  = string(contracts.ContractWorkflowDefinition)
)

type Scope struct {
	IDs        []string `json:"ids,omitempty"`
	TeamIDs    []string `json:"teamIds,omitempty"`
	ProjectIDs []string `json:"projectIds,omitempty"`
}

func (s Scope) Empty() bool {
	return len(s.IDs) == 0 && len(s.TeamIDs) == 0 && len(s.ProjectIDs) == 0
}

type ExecutionContext struct {
	ContractVersion string `json:"contractVersion"`
	RequestID       string `json:"requestId"`
	TraceID         string `json:"traceId,omitempty"`
	WorkflowID      string `json:"workflowId"`
	RunID           string `json:"runId,omitempty"`
	OrganizationID  string `json:"organizationId"`
	ActorID         string `json:"actorId"`
	Scope           Scope  `json:"scope"`
	PolicyVersion   string `json:"policyVersion"`
}

func (c ExecutionContext) Validate(expectedContract string) error {
	if c.ContractVersion != expectedContract {
		return fmt.Errorf("unsupported contractVersion %q", c.ContractVersion)
	}
	if c.RequestID == "" || c.OrganizationID == "" {
		return fmt.Errorf("requestId and organizationId are required")
	}
	if expectedContract == ToolRequestContractVersion || expectedContract == ArtifactWriteContractVersion {
		if c.WorkflowID == "" || c.ActorID == "" || c.PolicyVersion == "" {
			return fmt.Errorf("workflowId, actorId, and policyVersion are required for tool requests")
		}
		if c.Scope.Empty() {
			return fmt.Errorf("scope is required for tool requests")
		}
	}
	return nil
}

type AuthorizationRequest struct {
	ExecutionContext
	Resource string `json:"resource"`
	Action   string `json:"action"`
}

type AuthorizationResponse struct {
	ContractVersion string `json:"contractVersion"`
	RequestID       string `json:"requestId"`
	Allowed         bool   `json:"allowed"`
	Decision        string `json:"decision"`
	PolicyVersion   string `json:"policyVersion"`
	Reason          string `json:"reason,omitempty"`
}

type ToolInvocationRequest struct {
	ExecutionContext
	AgentDefinition string         `json:"agentDefinition"`
	Tool            string         `json:"tool"`
	Arguments       map[string]any `json:"arguments"`
}

type ToolInvocationResponse struct {
	ContractVersion string                      `json:"contractVersion"`
	RequestID       string                      `json:"requestId"`
	Tool            string                      `json:"tool"`
	Status          string                      `json:"status"`
	Data            map[string]any              `json:"data,omitempty"`
	EvidenceRefs    []string                    `json:"evidenceRefs,omitempty"`
	Freshness       []contracts.SourceFreshness `json:"freshness,omitempty"`
}

type GraphQueryRequest struct {
	ExecutionContext
	Query  string         `json:"query"`
	Params map[string]any `json:"params,omitempty"`
}

type GraphNode struct {
	ID         string                    `json:"id"`
	Type       string                    `json:"type"`
	Properties map[string]any            `json:"properties"`
	Provenance *contracts.DataProvenance `json:"provenance,omitempty"`
}

type GraphEdge struct {
	ID           string                    `json:"id"`
	SourceID     string                    `json:"sourceId"`
	TargetID     string                    `json:"targetId"`
	Relationship string                    `json:"relationship"`
	Properties   map[string]any            `json:"properties"`
	Provenance   *contracts.DataProvenance `json:"provenance,omitempty"`
}

type GraphQueryResponse struct {
	ContractVersion string                      `json:"contractVersion"`
	RequestID       string                      `json:"requestId"`
	Status          string                      `json:"status"`
	Nodes           []GraphNode                 `json:"nodes"`
	Edges           []GraphEdge                 `json:"edges"`
	EvidenceRefs    []string                    `json:"evidenceRefs,omitempty"`
	Freshness       []contracts.SourceFreshness `json:"freshness,omitempty"`
}

type ArtifactWriteRequest struct {
	ExecutionContext
	ObjectKey      string                           `json:"objectKey"`
	ContentType    string                           `json:"contentType"`
	DataRef        string                           `json:"dataRef"`
	RetentionClass contracts.ArtifactRetentionClass `json:"retentionClass,omitempty"`
	RetentionUntil string                           `json:"retentionUntil,omitempty"`
}

type ArtifactWriteResponse struct {
	ContractVersion string                           `json:"contractVersion"`
	RequestID       string                           `json:"requestId"`
	ArtifactRef     string                           `json:"artifactRef"`
	ObjectKey       string                           `json:"objectKey"`
	Status          string                           `json:"status"`
	RetentionClass  contracts.ArtifactRetentionClass `json:"retentionClass,omitempty"`
	RetentionUntil  string                           `json:"retentionUntil,omitempty"`
}

// WorkflowStep is a builder node. Steps with the same satisfied dependencies
// can run in parallel; DependsOn expresses the directed workflow graph.
type WorkflowStep struct {
	ID               string                     `json:"id"`
	Kind             contracts.WorkflowStepKind `json:"kind"`
	Tool             string                     `json:"tool,omitempty"`
	AgentDefinition  string                     `json:"agentDefinition,omitempty"`
	DependsOn        []string                   `json:"dependsOn,omitempty"`
	Input            map[string]any             `json:"input,omitempty"`
	RequiresApproval bool                       `json:"requiresApproval,omitempty"`
}

type WorkflowBlueprint struct {
	ContractVersion  string            `json:"contractVersion"`
	BlueprintID      string            `json:"blueprintId"`
	Version          string            `json:"version"`
	Name             string            `json:"name"`
	WorkflowType     string            `json:"workflowType"`
	Purpose          string            `json:"purpose"`
	Enabled          bool              `json:"enabled"`
	Steps            []WorkflowStep    `json:"steps"`
	AllowedTools     []string          `json:"allowedTools,omitempty"`
	RequiredScopes   []string          `json:"requiredScopes,omitempty"`
	Parameters       map[string]string `json:"parameters,omitempty"`
	InputSchemaRef   string            `json:"inputSchemaRef,omitempty"`
	OutputSchemaRef  string            `json:"outputSchemaRef,omitempty"`
	RequiresApproval bool              `json:"requiresApproval"`
}

type WorkflowDefinitionRequest struct {
	ExecutionContext
	Blueprint WorkflowBlueprint `json:"blueprint"`
}

type WorkflowPermissionRequirement struct {
	Resource         string `json:"resource"`
	Action           string `json:"action"`
	Scope            Scope  `json:"scope,omitempty"`
	ApprovalRequired bool   `json:"approvalRequired"`
}

type WorkflowDefinitionResponse struct {
	ContractVersion       string                          `json:"contractVersion"`
	RequestID             string                          `json:"requestId"`
	WorkflowID            string                          `json:"workflowId"`
	Status                string                          `json:"status"`
	TemporalWorkflowType  string                          `json:"temporalWorkflowType"`
	TemporalStartRequired bool                            `json:"temporalStartRequired"`
	PolicyStatus          string                          `json:"policyStatus"`
	Permissions           []WorkflowPermissionRequirement `json:"permissions"`
	Blueprint             WorkflowBlueprint               `json:"blueprint"`
	Warnings              []string                        `json:"warnings,omitempty"`
}

type WorkflowCapability struct {
	ContractVersion  string          `json:"contractVersion"`
	Name             string          `json:"name"`
	Version          string          `json:"version"`
	Kind             string          `json:"kind"`
	Description      string          `json:"description"`
	SideEffects      string          `json:"sideEffects"`
	InputSchema      map[string]any  `json:"inputSchema"`
	OutputSchema     map[string]any  `json:"outputSchema"`
	Annotations      ToolAnnotations `json:"annotations"`
	RequiredScope    []string        `json:"requiredScope,omitempty"`
	Available        bool            `json:"available"`
	ApprovalRequired bool            `json:"approvalRequired"`
}

type ToolAnnotations struct {
	ReadOnlyHint    bool `json:"readOnlyHint"`
	DestructiveHint bool `json:"destructiveHint"`
	IdempotentHint  bool `json:"idempotentHint"`
	OpenWorldHint   bool `json:"openWorldHint"`
}
