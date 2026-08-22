package memory

import (
	"context"
	"fmt"
	"strings"

	contracts "github.com/andriishupta/encois/packages/contracts"
	aiplatform "google.golang.org/api/aiplatform/v1beta1"
)

type gcpStore struct {
	service         *aiplatform.Service
	reasoningEngine string
}

func NewGCPStore(ctx context.Context, reasoningEngine string) (Store, error) {
	if strings.TrimSpace(reasoningEngine) == "" {
		return nil, fmt.Errorf("GCP memory mode requires VERTEX_MEMORY_REASONING_ENGINE")
	}
	service, err := aiplatform.NewService(ctx)
	if err != nil {
		return nil, fmt.Errorf("create Vertex AI Memory Bank client: %w", err)
	}
	return &gcpStore{service: service, reasoningEngine: strings.TrimRight(reasoningEngine, "/")}, nil
}

func (s *gcpStore) Execute(ctx context.Context, request Request) (Result, error) {
	scope := map[string]string{
		"organization_id":  request.OrganizationID,
		"agent_definition": request.MemoryScope.AgentDefinition,
	}
	if request.MemoryScope.ProjectID != "" {
		scope["project_id"] = request.MemoryScope.ProjectID
	}
	if request.MemoryScope.UserID != "" {
		scope["user_id"] = request.MemoryScope.UserID
	}
	switch request.Operation {
	case "retrieve":
		return s.retrieve(ctx, request, scope)
	case "distill":
		return s.distill(ctx, request, scope)
	default:
		return Result{}, fmt.Errorf("unsupported memory operation %q", request.Operation)
	}
}

func (s *gcpStore) retrieve(ctx context.Context, request Request, scope map[string]string) (Result, error) {
	retrieve := &aiplatform.GoogleCloudAiplatformV1beta1RetrieveMemoriesRequest{Scope: scope}
	if strings.TrimSpace(request.Query) != "" {
		topK := request.MaxResults
		if topK <= 0 {
			topK = 3
		}
		retrieve.SimilaritySearchParams = &aiplatform.GoogleCloudAiplatformV1beta1RetrieveMemoriesRequestSimilaritySearchParams{SearchQuery: request.Query, TopK: int64(topK)}
	} else {
		pageSize := request.MaxResults
		if pageSize <= 0 {
			pageSize = 3
		}
		retrieve.SimpleRetrievalParams = &aiplatform.GoogleCloudAiplatformV1beta1RetrieveMemoriesRequestSimpleRetrievalParams{PageSize: int64(pageSize)}
	}
	response, err := s.service.Projects.Locations.ReasoningEngines.Memories.Retrieve(s.reasoningEngine, retrieve).Context(ctx).Do()
	if err != nil {
		return Result{}, fmt.Errorf("retrieve Vertex AI memories: %w", err)
	}
	records := make([]Record, 0, len(response.RetrievedMemories))
	for _, item := range response.RetrievedMemories {
		if item == nil || item.Memory == nil {
			continue
		}
		// Vertex Memory Bank is scoped by request, but keep the organization
		// boundary explicit at the adapter boundary as defense in depth.
		if item.Memory.Scope["organization_id"] != request.OrganizationID {
			continue
		}
		records = append(records, recordFromMemory(item.Memory))
	}
	return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: "completed", Memories: records}, nil
}

func (s *gcpStore) distill(ctx context.Context, request Request, scope map[string]string) (Result, error) {
	if request.Distillation == nil || strings.TrimSpace(request.Distillation.Summary) == "" {
		return Result{}, fmt.Errorf("distillation summary is required")
	}
	operation, err := s.service.Projects.Locations.ReasoningEngines.Memories.Generate(s.reasoningEngine, &aiplatform.GoogleCloudAiplatformV1beta1GenerateMemoriesRequest{
		Scope: scope,
		DirectMemoriesSource: &aiplatform.GoogleCloudAiplatformV1beta1GenerateMemoriesRequestDirectMemoriesSource{
			DirectMemories: []*aiplatform.GoogleCloudAiplatformV1beta1GenerateMemoriesRequestDirectMemoriesSourceDirectMemory{{Fact: request.Distillation.Summary}},
		},
	}).Context(ctx).Do()
	if err != nil {
		return Result{}, fmt.Errorf("generate Vertex AI memory: %w", err)
	}
	if operation != nil && !operation.Done && operation.Name != "" {
		operation, err = s.service.Projects.Locations.ReasoningEngines.Memories.Operations.Wait(operation.Name).Timeout("30s").Context(ctx).Do()
		if err != nil {
			return Result{}, fmt.Errorf("wait for Vertex AI memory generation: %w", err)
		}
	}
	if operation != nil && operation.Error != nil {
		return Result{}, fmt.Errorf("Vertex AI memory generation failed: %s", operation.Error.Message)
	}
	return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: "completed", Memories: []Record{{
		ID:              "vertex-memory:" + request.RequestID,
		AgentDefinition: request.MemoryScope.AgentDefinition,
		Summary:         request.Distillation.Summary,
		EvidenceRefs:    append([]string(nil), request.Distillation.EvidenceRefs...),
		ObservedAt:      request.Distillation.ObservedAt,
	}}}, nil
}

func recordFromMemory(value *aiplatform.GoogleCloudAiplatformV1beta1Memory) Record {
	return Record{ID: value.Name, Summary: value.Fact, AgentDefinition: value.Scope["agent_definition"], ObservedAt: value.UpdateTime, EvidenceRefs: []string{}, WorkflowID: value.Scope["workflow_id"], RunID: value.Scope["run_id"]}
}
