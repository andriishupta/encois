package workflows

import (
	"context"
	"fmt"

	contractschemas "github.com/andriishupta/encois/packages/contracts"
)

func ValidateSourceIngestionContract(_ context.Context, input SourceIngestionWorkflowInput) error {
	payload := map[string]any{
		"contractVersion":  input.ContractVersion,
		"requestId":        input.RequestID,
		"workflowId":       input.WorkflowID,
		"organizationId":   input.OrganizationID,
		"actorId":          input.ActorID,
		"policyVersion":    input.PolicyVersion,
		"scope":            input.Scope,
		"sourceId":         input.SourceID,
		"sourceRevisionId": input.SourceRevisionID,
		"sourceKind":       input.SourceKind,
		"trigger":          input.Trigger,
		"readScope":        input.ReadScope,
		"visibilityScope":  input.VisibilityScope,
	}
	for key, value := range map[string]any{
		"traceId":        input.TraceID,
		"provider":       input.Provider,
		"artifactRef":    input.ArtifactRef,
		"sourceObjectId": input.SourceObjectID,
		"contentType":    input.ContentType,
	} {
		if stringValue, ok := value.(string); ok && stringValue != "" {
			payload[key] = stringValue
		}
	}
	if err := contractschemas.Validate(contractschemas.SchemaSourceIngestion, payload); err != nil {
		return fmt.Errorf("validate source ingestion contract: %w", err)
	}
	return nil
}

func ValidateSourceIngestionResult(_ context.Context, result SourceIngestionWorkflowResult) error {
	payload := map[string]any{
		"contractVersion":  result.ContractVersion,
		"requestId":        result.RequestID,
		"sourceId":         result.SourceID,
		"sourceRevisionId": result.SourceRevisionID,
		"status":           result.Status,
		"stage":            result.Stage,
		"factsCount":       result.FactsCount,
		"evidenceRefs":     result.EvidenceRefs,
	}
	if result.Message != "" {
		payload["message"] = result.Message
	}
	if err := contractschemas.Validate(contractschemas.SchemaSourceIngestionResult, payload); err != nil {
		return fmt.Errorf("validate source ingestion result: %w", err)
	}
	return nil
}

// ProcessSourceRevision is the explicit adapter seam for the shared pipeline:
// acquire/fetch -> parse -> validate/scope/redact -> extract -> normalize ->
// Graph projection -> optional Memory distillation. The MVP returns deferred
// until a concrete ArtifactStore/provider parser and Graph writer are wired.
func ProcessSourceRevision(_ context.Context, input SourceIngestionWorkflowInput) (SourceIngestionWorkflowResult, error) {
	evidenceRefs := make([]string, 0, 1)
	if input.ArtifactRef != "" {
		evidenceRefs = append(evidenceRefs, input.ArtifactRef)
	}
	message := "source acquisition/parser adapters are not configured; raw artifact and provenance are preserved for the next pipeline stage"
	if input.SourceKind == "integration" && input.Provider != "" {
		message = fmt.Sprintf("provider adapter %q and downstream extractors are not configured", input.Provider)
	}
	return SourceIngestionWorkflowResult{
		ContractVersion:  string(contractschemas.ContractSourceIngestionResult),
		RequestID:        input.RequestID,
		SourceID:         input.SourceID,
		SourceRevisionID: input.SourceRevisionID,
		Status:           contractschemas.IngestionStatusDeferred,
		Stage:            "acquired",
		FactsCount:       0,
		EvidenceRefs:     evidenceRefs,
		Message:          message,
	}, nil
}
