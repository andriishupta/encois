package workflows

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/gatewayclient"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/memory"
	contractschemas "github.com/andriishupta/encois/packages/contracts"
)

type RawSource struct {
	Bytes       []byte
	ContentType string
	ArtifactRef string
	SourceID    string
	ObservedAt  string
}

type SourceReader interface {
	Read(context.Context, SourceIngestionWorkflowInput) (RawSource, error)
}

type mockSourceReader struct{}

func (mockSourceReader) Read(_ context.Context, input SourceIngestionWorkflowInput) (RawSource, error) {
	contentType := input.ContentType
	if contentType == "" {
		contentType = "text/plain"
	}
	text := fmt.Sprintf("source=%s\nrevision=%s\norganization=%s\n", input.SourceID, input.SourceRevisionID, input.OrganizationID)
	if input.Provider == "jira" {
		text += "release has 10 Jira tasks; 8 completed; 1 blocked\n"
	} else if input.Provider == "github" {
		text += "checkout repository has 2 open pull requests; 1 failing check\n"
	} else {
		text += "mock knowledge source content\n"
	}
	return RawSource{Bytes: []byte(text), ContentType: contentType, ArtifactRef: input.ArtifactRef, SourceID: input.SourceID, ObservedAt: time.Now().UTC().Format(time.RFC3339)}, nil
}

type gatewaySourceReader struct {
	client *gatewayclient.Client
	mock   mockSourceReader
}

func (r gatewaySourceReader) Read(ctx context.Context, input SourceIngestionWorkflowInput) (RawSource, error) {
	if input.ArtifactRef == "" {
		return r.mock.Read(ctx, input)
	}
	result, err := r.client.ReadArtifact(ctx, gatewayclient.ArtifactReadRequest{
		ContractVersion: string(contractschemas.ContractArtifactRead),
		RequestID:       input.RequestID + ":artifact-read",
		TraceID:         input.TraceID,
		WorkflowID:      input.WorkflowID,
		OrganizationID:  input.OrganizationID,
		ActorID:         input.ActorID,
		PolicyVersion:   input.PolicyVersion,
		Scope:           input.Scope,
		Capability:      input.Capability,
		ArtifactRef:     input.ArtifactRef,
	})
	if err != nil {
		return RawSource{}, err
	}
	contentType := result.ContentType
	if contentType == "" {
		contentType = input.ContentType
	}
	return RawSource{Bytes: result.Bytes, ContentType: contentType, ArtifactRef: input.ArtifactRef, SourceID: input.SourceID, ObservedAt: time.Now().UTC().Format(time.RFC3339)}, nil
}

type SourceIngestionActivities struct {
	reader  SourceReader
	gateway *gatewayclient.Client
	memory  memory.Store
}

func NewSourceIngestionActivities(gateway *gatewayclient.Client, store memory.Store) *SourceIngestionActivities {
	if store == nil {
		store = memory.NewMockStore()
	}
	reader := SourceReader(mockSourceReader{})
	if gateway != nil {
		reader = gatewaySourceReader{client: gateway}
	}
	return &SourceIngestionActivities{reader: reader, gateway: gateway, memory: store}
}

func ValidateSourceIngestionContract(_ context.Context, input SourceIngestionWorkflowInput) error {
	payload := map[string]any{
		"contractVersion": input.ContractVersion, "requestId": input.RequestID, "workflowId": input.WorkflowID,
		"organizationId": input.OrganizationID, "actorId": input.ActorID, "policyVersion": input.PolicyVersion,
		"capability": input.Capability,
		"scope":      input.Scope, "sourceId": input.SourceID, "sourceRevisionId": input.SourceRevisionID,
		"sourceKind": input.SourceKind, "trigger": input.Trigger, "readScope": input.ReadScope, "visibilityScope": input.VisibilityScope,
	}
	for key, value := range map[string]any{"traceId": input.TraceID, "provider": input.Provider, "artifactRef": input.ArtifactRef, "sourceObjectId": input.SourceObjectID, "contentType": input.ContentType} {
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
		"contractVersion": result.ContractVersion, "requestId": result.RequestID, "sourceId": result.SourceID,
		"sourceRevisionId": result.SourceRevisionID, "status": result.Status, "stage": result.Stage,
		"factsCount": result.FactsCount, "evidenceRefs": result.EvidenceRefs,
	}
	if result.Message != "" {
		payload["message"] = result.Message
	}
	if err := contractschemas.Validate(contractschemas.SchemaSourceIngestionResult, payload); err != nil {
		return fmt.Errorf("validate source ingestion result: %w", err)
	}
	return nil
}

// ProcessSourceRevision is kept as a local fixture entry point for unit tests;
// production workers register the injected method below.
func ProcessSourceRevision(ctx context.Context, input SourceIngestionWorkflowInput) (SourceIngestionWorkflowResult, error) {
	return NewSourceIngestionActivities(nil, nil).ProcessSourceRevision(ctx, input)
}

func (a *SourceIngestionActivities) ProcessSourceRevision(ctx context.Context, input SourceIngestionWorkflowInput) (SourceIngestionWorkflowResult, error) {
	raw, err := a.reader.Read(ctx, input)
	if err != nil {
		return SourceIngestionWorkflowResult{}, fmt.Errorf("acquire source revision: %w", err)
	}
	text := normalizeSourceText(raw.Bytes, raw.ContentType, input.ArtifactRef)
	facts := extractFacts(text)
	if len(facts) == 0 {
		facts = []string{"source revision was acquired and contained no extractable text"}
	}
	for index, fact := range facts {
		facts[index], _ = memory.RedactSensitiveText(fact)
	}
	ingestedAt := time.Now().UTC().Format(time.RFC3339)
	provenance := map[string]any{
		"source":                input.Provider,
		"sourceId":              input.SourceID,
		"sourceRevisionId":      input.SourceRevisionID,
		"artifactRef":           input.ArtifactRef,
		"observedAt":            raw.ObservedAt,
		"ingestedAt":            ingestedAt,
		"transformationVersion": "source-facts-deterministic-1",
		"visibilityScope":       scopeIDs(input.VisibilityScope),
	}
	if provenance["source"] == "" {
		provenance["source"] = string(input.SourceKind)
	}
	if a.gateway != nil {
		nodes := make([]gatewayclient.GraphNode, 0, len(facts))
		for index, fact := range facts {
			digest := sha256.Sum256([]byte(input.SourceRevisionID + "\x00" + fmt.Sprint(index) + "\x00" + fact))
			nodes = append(nodes, gatewayclient.GraphNode{ID: "fact:" + hex.EncodeToString(digest[:]), Type: "source_fact", Properties: map[string]any{"text": fact, "sourceId": input.SourceID, "sourceRevisionId": input.SourceRevisionID}, Provenance: provenance})
		}
		if err := a.gateway.UpsertGraph(ctx, gatewayclient.GraphMutation{ContractVersion: string(contractschemas.ContractGraphUpsert), RequestID: input.RequestID + ":graph", TraceID: input.TraceID, WorkflowID: input.WorkflowID, OrganizationID: input.OrganizationID, ActorID: input.ActorID, PolicyVersion: input.PolicyVersion, Scope: input.Scope, Capability: input.Capability, Nodes: nodes}); err != nil {
			return SourceIngestionWorkflowResult{}, fmt.Errorf("project source facts into graph: %w", err)
		}
	}
	evidenceRefs := make([]string, 0, 2)
	if input.ArtifactRef != "" {
		evidenceRefs = append(evidenceRefs, input.ArtifactRef)
	}
	evidenceRefs = append(evidenceRefs, "source:"+input.SourceID+":"+input.SourceRevisionID)
	summary := strings.Join(facts, " ")
	memoryRequest := memory.Request{
		ContractVersion: string(contractschemas.ContractAgentMemory), RequestID: input.RequestID + ":memory", WorkflowID: input.WorkflowID,
		TraceID: input.TraceID, RunID: "", OrganizationID: input.OrganizationID, ActorID: input.ActorID, Scope: memory.Scope{IDs: scopeIDs(input.VisibilityScope)}, Capability: input.Capability,
		PolicyVersion: input.PolicyVersion, AgentDefinition: "source-ingestion", Operation: "distill", MemoryScope: memory.MemoryScope{AgentDefinition: "source-ingestion"},
		Distillation: &memory.Distillation{Summary: summary, EvidenceRefs: evidenceRefs, ObservedAt: raw.ObservedAt, RedactionStatus: contractschemas.RedactionApplied, RedactionVersion: "source-redaction-1"},
	}
	_, err = a.memory.Execute(ctx, memory.SanitizeRequest(memoryRequest))
	if err != nil {
		return SourceIngestionWorkflowResult{}, fmt.Errorf("distill source memory: %w", err)
	}
	return SourceIngestionWorkflowResult{ContractVersion: string(contractschemas.ContractSourceIngestionResult), RequestID: input.RequestID, SourceID: input.SourceID, SourceRevisionID: input.SourceRevisionID, Status: contractschemas.IngestionStatusCompleted, Stage: "memory_distilled", FactsCount: len(facts), EvidenceRefs: evidenceRefs, Freshness: []contractschemas.SourceFreshness{{Source: provenance["source"].(string), ObservedAt: raw.ObservedAt, IngestedAt: ingestedAt, Status: contractschemas.FreshnessFresh}}}, nil
}

func normalizeSourceText(bytes []byte, contentType, artifactRef string) string {
	if strings.HasPrefix(contentType, "text/") || contentType == "application/json" || contentType == "" {
		return string(bytes)
	}
	var builder strings.Builder
	for _, value := range string(bytes) {
		if unicode.IsLetter(value) || unicode.IsDigit(value) || unicode.IsSpace(value) || strings.ContainsRune(".,:;!?-_()/", value) {
			builder.WriteRune(value)
		}
	}
	text := strings.TrimSpace(builder.String())
	if text == "" {
		return "uploaded artifact " + artifactRef
	}
	return text
}

func extractFacts(text string) []string {
	lines := strings.FieldsFunc(text, func(value rune) bool { return value == '\n' || value == '\r' })
	facts := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.Join(strings.Fields(line), " ")
		if len(line) < 3 {
			continue
		}
		if len(line) > 500 {
			line = line[:500]
		}
		facts = append(facts, line)
	}
	return facts
}

func scopeIDs(scope map[string]any) []string {
	if values, ok := scope["ids"].([]string); ok && len(values) > 0 {
		return append([]string(nil), values...)
	}
	if values, ok := scope["ids"].([]any); ok {
		ids := make([]string, 0, len(values))
		for _, value := range values {
			if id, ok := value.(string); ok && id != "" {
				ids = append(ids, id)
			}
		}
		if len(ids) > 0 {
			return ids
		}
	}
	return []string{"*"}
}
