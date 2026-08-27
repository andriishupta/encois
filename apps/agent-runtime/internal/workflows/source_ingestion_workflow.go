package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	contracts "github.com/andriishupta/encois/packages/contracts"
)

// SourceIngestionWorkflowInput is the platform-owned execution envelope for
// one immutable source revision. User-created Blueprints do not become source
// ingestion workflows; they can consume the resulting evidence later.
type SourceIngestionWorkflowInput struct {
	ContractVersion  string                           `json:"contractVersion"`
	RequestID        string                           `json:"requestId"`
	TraceID          string                           `json:"traceId,omitempty"`
	WorkflowID       string                           `json:"workflowId"`
	OrganizationID   string                           `json:"organizationId"`
	ActorID          string                           `json:"actorId"`
	PolicyVersion    string                           `json:"policyVersion"`
	Capability       string                           `json:"capability"`
	Scope            map[string]any                   `json:"scope"`
	SourceID         string                           `json:"sourceId"`
	SourceRevisionID string                           `json:"sourceRevisionId"`
	SourceKind       contracts.KnowledgeSourceKind    `json:"sourceKind"`
	Provider         string                           `json:"provider,omitempty"`
	ArtifactRef      string                           `json:"artifactRef,omitempty"`
	SourceObjectID   string                           `json:"sourceObjectId,omitempty"`
	ContentType      string                           `json:"contentType,omitempty"`
	Trigger          contracts.SourceIngestionTrigger `json:"trigger"`
	ReadScope        map[string]any                   `json:"readScope"`
	VisibilityScope  map[string]any                   `json:"visibilityScope"`
}

type SourceIngestionWorkflowResult struct {
	ContractVersion  string                          `json:"contractVersion"`
	RequestID        string                          `json:"requestId"`
	SourceID         string                          `json:"sourceId"`
	SourceRevisionID string                          `json:"sourceRevisionId"`
	Status           contracts.SourceIngestionStatus `json:"status"`
	Stage            string                          `json:"stage"`
	FactsCount       int                             `json:"factsCount"`
	EvidenceRefs     []string                        `json:"evidenceRefs"`
	Freshness        []contracts.SourceFreshness     `json:"freshness,omitempty"`
	Message          string                          `json:"message,omitempty"`
}

// SourceIngestionWorkflow is intentionally a small, durable coordinator for
// the common ingestion pipeline. Acquisition and parsing remain Activities so
// provider SDKs, PDF/OCR, Graph, and Memory adapters can evolve independently.
func SourceIngestionWorkflow(ctx workflow.Context, input SourceIngestionWorkflowInput) (SourceIngestionWorkflowResult, error) {
	if err := validateSourceIngestionWorkflowInput(input); err != nil {
		return SourceIngestionWorkflowResult{}, err
	}

	activityCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 1,
		},
	})
	if err := workflow.ExecuteActivity(activityCtx, "ValidateSourceIngestionContract", input).Get(ctx, nil); err != nil {
		return SourceIngestionWorkflowResult{}, err
	}

	var result SourceIngestionWorkflowResult
	if err := workflow.ExecuteActivity(activityCtx, "ProcessSourceRevision", input).Get(ctx, &result); err != nil {
		return SourceIngestionWorkflowResult{}, err
	}
	if err := workflow.ExecuteActivity(activityCtx, "ValidateSourceIngestionResult", result).Get(ctx, nil); err != nil {
		return SourceIngestionWorkflowResult{}, err
	}
	return result, nil
}

func validateSourceIngestionWorkflowInput(input SourceIngestionWorkflowInput) error {
	if input.ContractVersion != string(contracts.ContractSourceIngestion) {
		return fmt.Errorf("unsupported source ingestion contractVersion %q", input.ContractVersion)
	}
	if input.RequestID == "" || input.WorkflowID == "" || input.OrganizationID == "" || input.ActorID == "" || input.PolicyVersion == "" || input.Capability == "" {
		return fmt.Errorf("source ingestion execution context is incomplete")
	}
	if !workflowIDBelongsToOrganization(input.WorkflowID, input.OrganizationID) {
		return fmt.Errorf("workflow id is outside the organization scope")
	}
	if input.SourceID == "" || input.SourceRevisionID == "" || input.Trigger == "" || input.SourceKind == "" {
		return fmt.Errorf("source ingestion source identity is incomplete")
	}
	return nil
}
