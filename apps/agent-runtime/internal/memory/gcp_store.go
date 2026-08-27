package memory

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	contracts "github.com/andriishupta/encois/packages/contracts"
	aiplatform "google.golang.org/api/aiplatform/v1beta1"
	"google.golang.org/api/option"
)

type gcpStore struct {
	service         *aiplatform.Service
	reasoningEngine string
}

func NewGCPStore(ctx context.Context, reasoningEngine, googleCloudLocation string) (Store, error) {
	reasoningEngine = strings.TrimRight(strings.TrimSpace(reasoningEngine), "/")
	if reasoningEngine == "" {
		return nil, fmt.Errorf("GCP memory mode requires AGENT_PLATFORM_MEMORY_REASONING_ENGINE")
	}
	googleCloudLocation = strings.ToLower(strings.TrimSpace(googleCloudLocation))
	if !validGoogleCloudLocation(googleCloudLocation) {
		return nil, fmt.Errorf("GOOGLE_CLOUD_LOCATION must contain only lowercase letters, digits, and hyphens")
	}
	if err := validateReasoningEngineResource(reasoningEngine, googleCloudLocation); err != nil {
		return nil, err
	}
	endpoint := "https://" + googleCloudLocation + "-aiplatform.googleapis.com/"
	if googleCloudLocation == "global" {
		endpoint = "https://aiplatform.googleapis.com/"
	}
	service, err := aiplatform.NewService(ctx, option.WithEndpoint(endpoint))
	if err != nil {
		return nil, fmt.Errorf("create Agent Platform Memory Bank client: %w", err)
	}
	return &gcpStore{service: service, reasoningEngine: reasoningEngine}, nil
}

func validGoogleCloudLocation(location string) bool {
	if location == "" {
		return false
	}
	for _, value := range location {
		if (value < 'a' || value > 'z') && (value < '0' || value > '9') && value != '-' {
			return false
		}
	}
	return true
}

func validateReasoningEngineResource(reasoningEngine, googleCloudLocation string) error {
	parts := strings.Split(reasoningEngine, "/")
	if len(parts) != 6 || parts[0] != "projects" || parts[1] == "" || parts[2] != "locations" || parts[3] == "" || parts[4] != "reasoningEngines" || parts[5] == "" {
		return fmt.Errorf("AGENT_PLATFORM_MEMORY_REASONING_ENGINE must be a full Reasoning Engine resource name")
	}
	if parts[3] != googleCloudLocation {
		return fmt.Errorf("Reasoning Engine location %q must match GOOGLE_CLOUD_LOCATION %q", parts[3], googleCloudLocation)
	}
	return nil
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
	case "correct":
		return s.correct(ctx, request)
	case "delete":
		return s.delete(ctx, request)
	default:
		return Result{}, fmt.Errorf("unsupported memory operation %q", request.Operation)
	}
}

func (s *gcpStore) target(ctx context.Context, request Request) (*aiplatform.GoogleCloudAiplatformV1beta1Memory, error) {
	target := strings.TrimSpace(request.TargetMemoryID)
	if target == "" || !strings.HasPrefix(target, s.reasoningEngine+"/memories/") {
		return nil, fmt.Errorf("memory target is outside the configured reasoning engine")
	}
	value, err := s.service.Projects.Locations.ReasoningEngines.Memories.Get(target).Context(ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("get Agent Platform memory: %w", err)
	}
	if value.Scope["organization_id"] != request.OrganizationID || value.Scope["agent_definition"] != request.MemoryScope.AgentDefinition {
		return nil, fmt.Errorf("memory target scope does not match the request")
	}
	if value.Scope["project_id"] != request.MemoryScope.ProjectID {
		return nil, fmt.Errorf("memory target project scope does not match the request")
	}
	if value.Scope["user_id"] != request.MemoryScope.UserID {
		return nil, fmt.Errorf("memory target user scope does not match the request")
	}
	return value, nil
}

func (s *gcpStore) correct(ctx context.Context, request Request) (Result, error) {
	if strings.TrimSpace(request.ReplacementSummary) == "" {
		return Result{}, fmt.Errorf("replacement summary is required")
	}
	if _, err := s.target(ctx, request); err != nil {
		return Result{}, err
	}
	operation, err := s.service.Projects.Locations.ReasoningEngines.Memories.Patch(request.TargetMemoryID, &aiplatform.GoogleCloudAiplatformV1beta1Memory{Fact: request.ReplacementSummary}).UpdateMask("fact").Context(ctx).Do()
	if err != nil {
		return Result{}, fmt.Errorf("patch Agent Platform memory: %w", err)
	}
	if err := s.wait(ctx, operation); err != nil {
		return Result{}, err
	}
	updated, err := s.service.Projects.Locations.ReasoningEngines.Memories.Get(request.TargetMemoryID).Context(ctx).Do()
	if err != nil {
		return Result{}, fmt.Errorf("get updated Agent Platform memory: %w", err)
	}
	return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: "completed", Memories: []Record{recordFromMemory(updated)}}, nil
}

func (s *gcpStore) delete(ctx context.Context, request Request) (Result, error) {
	if _, err := s.target(ctx, request); err != nil {
		return Result{}, err
	}
	operation, err := s.service.Projects.Locations.ReasoningEngines.Memories.Delete(request.TargetMemoryID).Context(ctx).Do()
	if err != nil {
		return Result{}, fmt.Errorf("delete Agent Platform memory: %w", err)
	}
	if err := s.wait(ctx, operation); err != nil {
		return Result{}, err
	}
	return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: "completed", Memories: []Record{}}, nil
}

func (s *gcpStore) wait(ctx context.Context, operation *aiplatform.GoogleLongrunningOperation) error {
	if operation == nil || operation.Done {
		if operation != nil && operation.Error != nil {
			return fmt.Errorf("Agent Platform memory operation failed: %s", operation.Error.Message)
		}
		return nil
	}
	if operation.Name == "" {
		return fmt.Errorf("Agent Platform memory operation returned no name")
	}
	completed, err := s.service.Projects.Locations.ReasoningEngines.Memories.Operations.Wait(operation.Name).Timeout("30s").Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("wait for Agent Platform memory operation: %w", err)
	}
	if completed != nil && completed.Error != nil {
		return fmt.Errorf("Agent Platform memory operation failed: %s", completed.Error.Message)
	}
	return nil
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
		return Result{}, fmt.Errorf("retrieve Agent Platform memories: %w", err)
	}
	records := make([]Record, 0, len(response.RetrievedMemories))
	for _, item := range response.RetrievedMemories {
		if item == nil || item.Memory == nil {
			continue
		}
		// Agent Platform Memory Bank is scoped by request, but keep the organization
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
		return Result{}, fmt.Errorf("generate Agent Platform memory: %w", err)
	}
	if operation != nil && !operation.Done && operation.Name != "" {
		operation, err = s.service.Projects.Locations.ReasoningEngines.Memories.Operations.Wait(operation.Name).Timeout("30s").Context(ctx).Do()
		if err != nil {
			return Result{}, fmt.Errorf("wait for Agent Platform memory generation: %w", err)
		}
	}
	if operation != nil && operation.Error != nil {
		return Result{}, fmt.Errorf("Agent Platform memory generation failed: %s", operation.Error.Message)
	}
	records, err := generatedRecords(operation, request, s.reasoningEngine)
	if err != nil {
		return Result{}, err
	}
	return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: "completed", Memories: records}, nil
}

type generatedMemoriesResponse struct {
	GeneratedMemories []generatedMemory `json:"generatedMemories"`
}

type generatedMemory struct {
	Action string                `json:"action"`
	Memory generatedMemoryRecord `json:"memory"`
}

type generatedMemoryRecord struct {
	Name       string            `json:"name"`
	Fact       string            `json:"fact"`
	Scope      map[string]string `json:"scope"`
	CreateTime string            `json:"createTime"`
	UpdateTime string            `json:"updateTime"`
}

func generatedRecords(operation *aiplatform.GoogleLongrunningOperation, request Request, reasoningEngine string) ([]Record, error) {
	if operation == nil || len(operation.Response) == 0 {
		return nil, fmt.Errorf("Agent Platform memory generation returned no generated memories")
	}
	var response generatedMemoriesResponse
	if err := json.Unmarshal(operation.Response, &response); err != nil {
		return nil, fmt.Errorf("decode Agent Platform generated memories: %w", err)
	}
	records := make([]Record, 0, len(response.GeneratedMemories))
	prefix := strings.TrimRight(reasoningEngine, "/") + "/memories/"
	for _, generated := range response.GeneratedMemories {
		if generated.Action != "" && generated.Action != "CREATED" && generated.Action != "UPDATED" {
			continue
		}
		memory := generated.Memory
		if strings.TrimSpace(memory.Name) == "" || !strings.HasPrefix(memory.Name, prefix) {
			continue
		}
		if err := validateGeneratedMemoryScope(memory.Scope, request); err != nil {
			return nil, err
		}
		observedAt := memory.UpdateTime
		if observedAt == "" {
			observedAt = memory.CreateTime
		}
		if observedAt == "" {
			observedAt = request.Distillation.ObservedAt
		}
		summary := memory.Fact
		if summary == "" {
			summary = request.Distillation.Summary
		}
		records = append(records, Record{
			ID:              memory.Name,
			AgentDefinition: request.MemoryScope.AgentDefinition,
			ProjectID:       request.MemoryScope.ProjectID,
			UserID:          request.MemoryScope.UserID,
			Summary:         summary,
			EvidenceRefs:    append([]string(nil), request.Distillation.EvidenceRefs...),
			ObservedAt:      observedAt,
		})
	}
	if len(records) == 0 {
		return nil, fmt.Errorf("Agent Platform memory generation completed without a created or updated memory")
	}
	return records, nil
}

func validateGeneratedMemoryScope(scope map[string]string, request Request) error {
	expected := map[string]string{
		"organization_id":  request.OrganizationID,
		"agent_definition": request.MemoryScope.AgentDefinition,
		"project_id":       request.MemoryScope.ProjectID,
		"user_id":          request.MemoryScope.UserID,
	}
	for key, value := range expected {
		if actual, ok := scope[key]; ok && actual != value {
			return fmt.Errorf("generated memory scope %q does not match the request", key)
		}
	}
	return nil
}

func recordFromMemory(value *aiplatform.GoogleCloudAiplatformV1beta1Memory) Record {
	return Record{ID: value.Name, Summary: value.Fact, AgentDefinition: value.Scope["agent_definition"], ProjectID: value.Scope["project_id"], UserID: value.Scope["user_id"], ObservedAt: value.UpdateTime, EvidenceRefs: []string{}, WorkflowID: value.Scope["workflow_id"], RunID: value.Scope["run_id"]}
}
