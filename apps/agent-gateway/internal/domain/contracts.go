package domain

import "fmt"

const (
	ToolRequestContractVersion        = "tool-request.v1"
	GraphQueryContractVersion         = "graph-query.v1"
	ArtifactWriteContractVersion      = "artifact-write.v1"
	AuthorizationContractVersion      = "authorization-check.v1"
	ToolResultContractVersion         = "tool-result.v1"
	WorkflowBlueprintContractVersion  = "workflow-blueprint.v1"
	WorkflowDefinitionContractVersion = "workflow-definition.v1"
)

type Scope struct {
	TeamIDs    []string `json:"teamIds,omitempty"`
	ProjectIDs []string `json:"projectIds,omitempty"`
}

type ExecutionContext struct {
	ContractVersion string `json:"contractVersion"`
	RequestID       string `json:"requestId"`
	WorkflowID      string `json:"workflowId"`
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
	Input           map[string]any `json:"input"`
}

type ToolInvocationResponse struct {
	ContractVersion string         `json:"contractVersion"`
	RequestID       string         `json:"requestId"`
	Tool            string         `json:"tool"`
	Status          string         `json:"status"`
	Data            map[string]any `json:"data,omitempty"`
	EvidenceRefs    []string       `json:"evidenceRefs,omitempty"`
}

type GraphQueryRequest struct {
	ExecutionContext
	Query  string         `json:"query"`
	Params map[string]any `json:"params,omitempty"`
}

type ArtifactWriteRequest struct {
	ExecutionContext
	ObjectKey   string `json:"objectKey"`
	ContentType string `json:"contentType"`
	DataRef     string `json:"dataRef"`
}

// WorkflowStep is a builder node. Steps with the same satisfied dependencies
// can run in parallel; DependsOn expresses the directed workflow graph.
type WorkflowStep struct {
	ID               string         `json:"id"`
	Kind             string         `json:"kind"`
	Tool             string         `json:"tool,omitempty"`
	AgentDefinition  string         `json:"agentDefinition,omitempty"`
	DependsOn        []string       `json:"dependsOn,omitempty"`
	Input            map[string]any `json:"input,omitempty"`
	RequiresApproval bool           `json:"requiresApproval,omitempty"`
}

type WorkflowSchedule struct {
	Cron     string `json:"cron,omitempty"`
	Timezone string `json:"timezone,omitempty"`
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
	Schedule         *WorkflowSchedule `json:"schedule,omitempty"`
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
	Name             string `json:"name"`
	Kind             string `json:"kind"`
	SideEffects      string `json:"sideEffects"`
	ApprovalRequired bool   `json:"approvalRequired"`
}
