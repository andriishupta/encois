package contracts

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"sync"

	"github.com/google/jsonschema-go/jsonschema"
)

// SchemaName identifies a canonical JSON Schema used at a cross-language
// boundary. The schema files themselves live next to the TypeScript contracts
// and are embedded here so Go services do not import TypeScript source.
type SchemaName string

const (
	SchemaWorkflowBlueprint     SchemaName = "workflowBlueprint"
	SchemaWorkflowResult        SchemaName = "workflowResult"
	SchemaWorkflowSignal        SchemaName = "workflowSignal"
	SchemaExecutionContext      SchemaName = "executionContext"
	SchemaToolRequest           SchemaName = "toolRequest"
	SchemaToolResult            SchemaName = "toolResult"
	SchemaArtifactWrite         SchemaName = "artifactWrite"
	SchemaArtifactRead          SchemaName = "artifactRead"
	SchemaArtifactWriteResult   SchemaName = "artifactWriteResult"
	SchemaGraphQuery            SchemaName = "graphQuery"
	SchemaGraphUpsert           SchemaName = "graphUpsert"
	SchemaGraphQueryResult      SchemaName = "graphQueryResult"
	SchemaAgentMemory           SchemaName = "agentMemory"
	SchemaAgentMemoryResult     SchemaName = "agentMemoryResult"
	SchemaToolManifest          SchemaName = "toolManifest"
	SchemaWorkflowUpdate        SchemaName = "workflowUpdate"
	SchemaWorkflowChangePlan    SchemaName = "workflowChangePlan"
	SchemaCoordinatorEvent      SchemaName = "coordinatorEvent"
	SchemaCoordinator           SchemaName = "coordinator"
	SchemaBootstrapProject      SchemaName = "bootstrapProject"
	SchemaKnowledgeSource       SchemaName = "knowledgeSource"
	SchemaSourceRevision        SchemaName = "sourceRevision"
	SchemaSourceIngestion       SchemaName = "sourceIngestion"
	SchemaSourceIngestionResult SchemaName = "sourceIngestionResult"
)

//go:embed schemas/*.json
var schemaFiles embed.FS

var schemaPaths = map[SchemaName]string{
	SchemaWorkflowBlueprint:     "schemas/workflow-blueprint.v1.json",
	SchemaWorkflowResult:        "schemas/blueprint-workflow-result.v1.json",
	SchemaWorkflowSignal:        "schemas/workflow-signal.v1.json",
	SchemaExecutionContext:      "schemas/execution-context.v1.json",
	SchemaToolRequest:           "schemas/tool-request.v1.json",
	SchemaToolResult:            "schemas/tool-result.v1.json",
	SchemaArtifactWrite:         "schemas/artifact-write.v1.json",
	SchemaArtifactRead:          "schemas/artifact-read.v1.json",
	SchemaArtifactWriteResult:   "schemas/artifact-write-result.v1.json",
	SchemaGraphQuery:            "schemas/graph-query.v1.json",
	SchemaGraphUpsert:           "schemas/graph-upsert.v1.json",
	SchemaGraphQueryResult:      "schemas/graph-query-result.v1.json",
	SchemaAgentMemory:           "schemas/agent-memory.v1.json",
	SchemaAgentMemoryResult:     "schemas/agent-memory-result.v1.json",
	SchemaToolManifest:          "schemas/tool-manifest.v1.json",
	SchemaWorkflowUpdate:        "schemas/workflow-update.v1.json",
	SchemaWorkflowChangePlan:    "schemas/workflow-change-plan.v1.json",
	SchemaCoordinatorEvent:      "schemas/coordinator-event.v1.json",
	SchemaCoordinator:           "schemas/coordinator.v1.json",
	SchemaBootstrapProject:      "schemas/bootstrap-project.v1.json",
	SchemaKnowledgeSource:       "schemas/knowledge-source.v1.json",
	SchemaSourceRevision:        "schemas/source-revision.v1.json",
	SchemaSourceIngestion:       "schemas/source-ingestion.v1.json",
	SchemaSourceIngestionResult: "schemas/source-ingestion-result.v1.json",
}

var resolvedSchemas sync.Map // map[SchemaName]*jsonschema.Resolved

// Validate checks a Go value against the canonical JSON representation of a
// contract. Marshaling first is intentional: validation follows the wire JSON
// shape rather than Go-only fields or types.
func Validate(name SchemaName, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("marshal %s: %w", name, err)
	}
	return ValidateJSON(name, data)
}

// ValidateJSON validates one JSON document against an embedded canonical
// schema. It rejects trailing JSON values.
func ValidateJSON(name SchemaName, data []byte) error {
	resolved, err := schemaFor(name)
	if err != nil {
		return err
	}

	decoder := json.NewDecoder(bytes.NewReader(data))
	var value any
	if err := decoder.Decode(&value); err != nil {
		return fmt.Errorf("decode %s: %w", name, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("decode %s: document contains multiple JSON values", name)
		}
		return fmt.Errorf("decode %s: %w", name, err)
	}
	if err := resolved.Validate(value); err != nil {
		return fmt.Errorf("validate %s: %w", name, err)
	}
	return nil
}

func schemaFor(name SchemaName) (*jsonschema.Resolved, error) {
	if cached, ok := resolvedSchemas.Load(name); ok {
		return cached.(*jsonschema.Resolved), nil
	}

	path, ok := schemaPaths[name]
	if !ok {
		return nil, fmt.Errorf("unknown contract schema %q", name)
	}
	data, err := schemaFiles.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read contract schema %q: %w", name, err)
	}
	var schema jsonschema.Schema
	if err := json.Unmarshal(data, &schema); err != nil {
		return nil, fmt.Errorf("decode contract schema %q: %w", name, err)
	}
	resolved, err := schema.Resolve(nil)
	if err != nil {
		return nil, fmt.Errorf("resolve contract schema %q: %w", name, err)
	}
	actual, loaded := resolvedSchemas.LoadOrStore(name, resolved)
	if loaded {
		return actual.(*jsonschema.Resolved), nil
	}
	return resolved, nil
}
