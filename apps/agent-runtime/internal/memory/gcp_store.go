package memory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	contracts "github.com/andriishupta/encois/packages/contracts"
	aiplatform "google.golang.org/api/aiplatform/v1beta1"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/option"
)

type gcpStore struct {
	service         *aiplatform.Service
	reasoningEngine string
}

const providerHierarchyScopeKey = "organization_scope_ids"

const memoryObservationTimeout = 30 * time.Second

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
	scope, err := providerScope(request)
	if err != nil {
		return Result{}, err
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
	expected, err := providerScope(request)
	if err != nil {
		return nil, err
	}
	if err := validateProviderMemoryScope(value.Scope, expected); err != nil {
		return nil, fmt.Errorf("memory target scope does not match the request: %w", err)
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
	if err := completedOperationError(operation); err != nil {
		return Result{}, fmt.Errorf("patch Agent Platform memory: %w", err)
	}
	updated, observed, err := s.observeMemoryUpdate(ctx, request.TargetMemoryID, request.ReplacementSummary)
	if err != nil {
		return Result{}, err
	}
	if !observed {
		return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: string(contracts.MemoryStatusDeferred), Memories: []Record{}}, nil
	}
	return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: string(contracts.MemoryStatusCompleted), Memories: []Record{recordFromMemory(updated)}}, nil
}

func (s *gcpStore) delete(ctx context.Context, request Request) (Result, error) {
	if _, err := s.target(ctx, request); err != nil {
		return Result{}, err
	}
	operation, err := s.service.Projects.Locations.ReasoningEngines.Memories.Delete(request.TargetMemoryID).Context(ctx).Do()
	if err != nil {
		return Result{}, fmt.Errorf("delete Agent Platform memory: %w", err)
	}
	if err := completedOperationError(operation); err != nil {
		return Result{}, fmt.Errorf("delete Agent Platform memory: %w", err)
	}
	deleted, err := s.observeMemoryDeletion(ctx, request.TargetMemoryID)
	if err != nil {
		return Result{}, err
	}
	status := contracts.MemoryStatusDeferred
	if deleted {
		status = contracts.MemoryStatusCompleted
	}
	return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: string(status), Memories: []Record{}}, nil
}

func completedOperationError(operation *aiplatform.GoogleLongrunningOperation) error {
	if operation != nil && operation.Done && operation.Error != nil {
		return fmt.Errorf("Agent Platform memory operation failed: %s", operation.Error.Message)
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
		if err := validateProviderMemoryScope(item.Memory.Scope, scope); err != nil {
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
	if operation == nil {
		return Result{}, fmt.Errorf("Agent Platform memory generation returned no operation")
	}
	if err := completedOperationError(operation); err != nil {
		return Result{}, err
	}
	if operation.Done {
		records, err := generatedRecords(operation, request, s.reasoningEngine)
		if err != nil {
			return Result{}, err
		}
		return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: string(contracts.MemoryStatusCompleted), Memories: records}, nil
	}
	records, observed, err := s.observeGeneratedMemories(ctx, request, scope)
	if err != nil {
		return Result{}, err
	}
	if !observed {
		return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: string(contracts.MemoryStatusDeferred), Memories: []Record{}}, nil
	}
	return Result{ContractVersion: string(contracts.ContractAgentMemoryResult), RequestID: request.RequestID, Status: string(contracts.MemoryStatusCompleted), Memories: records}, nil
}

func (s *gcpStore) observeGeneratedMemories(ctx context.Context, request Request, scope map[string]string) ([]Record, bool, error) {
	deadline := time.Now().Add(memoryObservationTimeout)
	queryRequest := request
	queryRequest.Operation = "retrieve"
	queryRequest.Query = request.Distillation.Summary
	queryRequest.MaxResults = 10
	for {
		result, err := s.retrieve(ctx, queryRequest, scope)
		if err != nil {
			return nil, false, fmt.Errorf("observe generated Agent Platform memory: %w", err)
		}
		for _, record := range result.Memories {
			if strings.TrimSpace(record.Summary) == strings.TrimSpace(request.Distillation.Summary) {
				record.EvidenceRefs = append([]string(nil), request.Distillation.EvidenceRefs...)
				return []Record{record}, true, nil
			}
		}
		if !time.Now().Before(deadline) {
			return nil, false, nil
		}
		if err := waitForMemoryObservation(ctx); err != nil {
			return nil, false, err
		}
	}
}

func (s *gcpStore) observeMemoryUpdate(ctx context.Context, name, summary string) (*aiplatform.GoogleCloudAiplatformV1beta1Memory, bool, error) {
	deadline := time.Now().Add(memoryObservationTimeout)
	for {
		value, err := s.service.Projects.Locations.ReasoningEngines.Memories.Get(name).Context(ctx).Do()
		if err != nil {
			return nil, false, fmt.Errorf("observe updated Agent Platform memory: %w", err)
		}
		if value.Fact == summary {
			return value, true, nil
		}
		if !time.Now().Before(deadline) {
			return nil, false, nil
		}
		if err := waitForMemoryObservation(ctx); err != nil {
			return nil, false, err
		}
	}
}

func (s *gcpStore) observeMemoryDeletion(ctx context.Context, name string) (bool, error) {
	deadline := time.Now().Add(memoryObservationTimeout)
	for {
		_, err := s.service.Projects.Locations.ReasoningEngines.Memories.Get(name).Context(ctx).Do()
		if err != nil {
			var apiError *googleapi.Error
			if errors.As(err, &apiError) && apiError.Code == 404 {
				return true, nil
			}
			return false, fmt.Errorf("observe deleted Agent Platform memory: %w", err)
		}
		if !time.Now().Before(deadline) {
			return false, nil
		}
		if err := waitForMemoryObservation(ctx); err != nil {
			return false, err
		}
	}
}

func waitForMemoryObservation(ctx context.Context) error {
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return fmt.Errorf("observe Agent Platform memory: %w", ctx.Err())
	case <-timer.C:
		return nil
	}
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
	if request.Distillation == nil {
		return nil, fmt.Errorf("Agent Platform generated memories require distillation context")
	}
	if operation == nil || len(operation.Response) == 0 {
		return nil, fmt.Errorf("Agent Platform memory generation returned no generated memories")
	}
	var response generatedMemoriesResponse
	if err := json.Unmarshal(operation.Response, &response); err != nil {
		return nil, fmt.Errorf("decode Agent Platform generated memories: %w", err)
	}
	records := make([]Record, 0, len(response.GeneratedMemories))
	prefix := strings.TrimRight(reasoningEngine, "/") + "/memories/"
	expectedScope, err := providerScope(request)
	if err != nil {
		return nil, err
	}
	for _, generated := range response.GeneratedMemories {
		if generated.Action != "CREATED" && generated.Action != "UPDATED" {
			continue
		}
		memory := generated.Memory
		if strings.TrimSpace(memory.Name) == "" || !strings.HasPrefix(memory.Name, prefix) {
			continue
		}
		if err := validateProviderMemoryScope(memory.Scope, expectedScope); err != nil {
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

func providerScope(request Request) (map[string]string, error) {
	hierarchyIDs := normalizedScopeIDs(request.Scope.IDs)
	if len(hierarchyIDs) == 0 {
		return nil, fmt.Errorf("memory hierarchy scope must contain at least one id")
	}
	encodedHierarchyIDs, err := json.Marshal(hierarchyIDs)
	if err != nil {
		return nil, fmt.Errorf("encode memory hierarchy scope: %w", err)
	}
	expected := map[string]string{
		"organization_id":         request.OrganizationID,
		"agent_definition":        request.MemoryScope.AgentDefinition,
		providerHierarchyScopeKey: string(encodedHierarchyIDs),
	}
	if request.MemoryScope.ProjectID != "" {
		expected["project_id"] = request.MemoryScope.ProjectID
	}
	if request.MemoryScope.UserID != "" {
		expected["user_id"] = request.MemoryScope.UserID
	}
	return expected, nil
}

func validateProviderMemoryScope(scope, expected map[string]string) error {
	for key, value := range expected {
		actual, ok := scope[key]
		if !ok || actual != value {
			return fmt.Errorf("provider memory scope %q does not match the request", key)
		}
	}
	return nil
}

func recordFromMemory(value *aiplatform.GoogleCloudAiplatformV1beta1Memory) Record {
	observedAt := value.UpdateTime
	if observedAt == "" {
		observedAt = value.CreateTime
	}
	return Record{ID: value.Name, Summary: value.Fact, AgentDefinition: value.Scope["agent_definition"], ProjectID: value.Scope["project_id"], UserID: value.Scope["user_id"], ObservedAt: observedAt, EvidenceRefs: []string{}, WorkflowID: value.Scope["workflow_id"], RunID: value.Scope["run_id"]}
}
