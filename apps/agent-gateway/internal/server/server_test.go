package server

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	"github.com/andriishupta/encois/apps/agent-gateway/internal/policy"
)

type recordingArtifactStore struct {
	writes int
}

func (s *recordingArtifactStore) Write(_ context.Context, request domain.ArtifactWriteRequest) (domain.ArtifactWriteResponse, error) {
	s.writes++
	return domain.ArtifactWriteResponse{
		ContractVersion: domain.ArtifactWriteResultContractVersion,
		RequestID:       request.RequestID,
		ArtifactRef:     "gs://test-bucket/" + request.ObjectKey,
		ObjectKey:       request.ObjectKey,
		Status:          "completed",
	}, nil
}

func (s *recordingArtifactStore) Read(_ context.Context, request domain.ArtifactReadRequest) (domain.ArtifactReadResponse, error) {
	return domain.ArtifactReadResponse{ArtifactRef: request.ArtifactRef, ContentType: "text/plain", Bytes: []byte("fixture")}, nil
}

type recordingGraphStore struct {
	queries int
}

func (s *recordingGraphStore) Query(_ context.Context, request domain.GraphQueryRequest) (domain.GraphQueryResponse, error) {
	s.queries++
	return domain.GraphQueryResponse{
		ContractVersion: domain.GraphQueryResultContractVersion,
		RequestID:       request.RequestID,
		Status:          "completed",
		Nodes:           []domain.GraphNode{{ID: "project-1", Type: "project", Properties: map[string]any{"key": "checkout"}}},
		Edges:           []domain.GraphEdge{{ID: "edge-1", SourceID: "project-1", TargetID: "team-1", Relationship: "belongs_to", Properties: map[string]any{}}},
	}, nil
}

func (s *recordingGraphStore) Upsert(context.Context, domain.GraphMutation) error { return nil }

func TestMockToolInvocation(t *testing.T) {
	router := NewRouter(policy.NewAllowAllPolicy("policy-test"), slog.Default(), "test-token")
	request := domain.ToolInvocationRequest{
		ExecutionContext: domain.ExecutionContext{
			ContractVersion: domain.ToolRequestContractVersion,
			RequestID:       "req-test",
			WorkflowID:      "workflow:org-test:project:one",
			OrganizationID:  "org-test",
			ActorID:         "actor-test",
			PolicyVersion:   "policy-test",
			Capability:      "test-capability",
			Scope:           domain.Scope{IDs: []string{"team-test"}},
		},
		Tool:      "jira.project_tasks",
		Arguments: map[string]any{},
	}
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	httpRequest := httptest.NewRequest(http.MethodPost, "/v1/tools/invoke", bytes.NewReader(body))
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer test-token")
	httpRequest.Header.Set("X-Trace-ID", "trace-test")
	router.ServeHTTP(response, httpRequest)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if response.Header().Get("X-Trace-ID") != "trace-test" {
		t.Fatalf("expected trace ID response header, got %q", response.Header().Get("X-Trace-ID"))
	}
	var result domain.ToolInvocationResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "mocked" || result.Data["completedTasks"] != float64(8) || len(result.EvidenceRefs) != 1 || result.EvidenceRefs[0] != "mock://organizations/org-test/jira/project-checkout" {
		t.Fatalf("unexpected mock result: %+v", result)
	}
}

func TestMemoryGraphStoreKeepsOrganizationsIsolated(t *testing.T) {
	store := newMemoryGraphStore()
	for _, fixture := range []struct {
		organizationID string
		label          string
	}{
		{organizationID: "organization-test", label: "test"},
		{organizationID: "organization-avengers", label: "avengers"},
	} {
		err := store.Upsert(context.Background(), domain.GraphMutation{
			ExecutionContext: domain.ExecutionContext{OrganizationID: fixture.organizationID},
			Nodes:            []domain.GraphNode{{ID: "shared-project-id", Type: "project", Properties: map[string]any{"organization": fixture.label}}},
		})
		if err != nil {
			t.Fatalf("upsert %s graph fixture: %v", fixture.organizationID, err)
		}
	}

	for _, fixture := range []struct {
		organizationID string
		label          string
	}{
		{organizationID: "organization-test", label: "test"},
		{organizationID: "organization-avengers", label: "avengers"},
	} {
		result, err := store.Query(context.Background(), domain.GraphQueryRequest{
			ExecutionContext: domain.ExecutionContext{OrganizationID: fixture.organizationID},
			Query:            "all",
		})
		if err != nil || len(result.Nodes) != 1 {
			t.Fatalf("expected one graph node for %s, result=%+v err=%v", fixture.organizationID, result, err)
		}
		if result.Nodes[0].Properties["organization"] != fixture.label {
			t.Fatalf("graph data crossed organization boundary: organization=%s result=%+v", fixture.organizationID, result.Nodes)
		}
	}
}

func TestMemoryGraphStoreCreatesTenantScopedLocalFixtures(t *testing.T) {
	store := newMemoryGraphStore()
	for _, organizationID := range []string{"organization-test", "organization-avengers"} {
		result, err := store.Query(context.Background(), domain.GraphQueryRequest{
			ExecutionContext: domain.ExecutionContext{OrganizationID: organizationID},
			Query:            "release.blockers",
		})
		if err != nil || len(result.Nodes) != 1 {
			t.Fatalf("expected one local blocker for %s, result=%+v err=%v", organizationID, result, err)
		}
		if result.Nodes[0].Properties["organizationId"] != organizationID {
			t.Fatalf("local graph fixture crossed organization boundary: organization=%s result=%+v", organizationID, result.Nodes)
		}
	}
}

func TestRequiresRuntimeServiceAuthentication(t *testing.T) {
	router := NewRouter(policy.NewReadOnlyToolPolicy("policy-test"), slog.Default(), "test-token")
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/tools", nil)
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", response.Code, response.Body.String())
	}
}

func TestToolCatalogExposesSchemasAnnotationsAndScopeRequirements(t *testing.T) {
	router := NewRouter(policy.NewReadOnlyToolPolicy("policy-test"), slog.Default(), "test-token")
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/tools", nil)
	request.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}

	var body struct {
		Tools []domain.WorkflowCapability `json:"tools"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Tools) < 2 {
		t.Fatalf("expected fixture tools in catalog, got %+v", body.Tools)
	}
	for _, tool := range body.Tools {
		if tool.ContractVersion != domain.ToolManifestContractVersion || tool.Version == "" || tool.Description == "" || tool.InputSchema == nil || tool.OutputSchema == nil {
			t.Fatalf("catalog entry is missing MCP metadata: %+v", tool)
		}
		if len(tool.RequiredScope) == 0 {
			t.Fatalf("catalog entry is missing required scope: %+v", tool)
		}
	}
}

func TestReadinessFailsClosedWhenServiceAuthenticationIsMissing(t *testing.T) {
	router := NewRouter(policy.NewReadOnlyToolPolicy("policy-test"), slog.Default(), "")
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	router.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", response.Code, response.Body.String())
	}
}

func TestAcceptsCloudRunIdentityWithSeparateServiceToken(t *testing.T) {
	router := NewRouter(policy.NewReadOnlyToolPolicy("policy-test"), slog.Default(), "test-token")
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/tools", nil)
	request.Header.Set("Authorization", "Bearer cloud-run-id-token")
	request.Header.Set("X-Encois-Service-Token", "test-token")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
}

func TestReadOnlyPolicyDeniesUnknownTool(t *testing.T) {
	router := NewRouter(policy.NewReadOnlyToolPolicy("policy-test"), slog.Default(), "test-token")
	request := domain.ToolInvocationRequest{
		ExecutionContext: domain.ExecutionContext{
			ContractVersion: domain.ToolRequestContractVersion,
			RequestID:       "req-test",
			WorkflowID:      "workflow:org-test:project:one",
			OrganizationID:  "org-test",
			ActorID:         "actor-test",
			PolicyVersion:   "policy-test",
			Capability:      "test-capability",
			Scope:           domain.Scope{IDs: []string{"team-test"}},
		},
		Tool:      "unknown.tool",
		Arguments: map[string]any{},
	}
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	httpRequest := httptest.NewRequest(http.MethodPost, "/v1/tools/invoke", bytes.NewReader(body))
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(response, httpRequest)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", response.Code, response.Body.String())
	}
}

func TestReadOnlyPolicyDeniesMismatchedPolicyVersion(t *testing.T) {
	router := NewRouter(policy.NewReadOnlyToolPolicy("policy-test"), slog.Default(), "test-token")
	request := domain.ToolInvocationRequest{
		ExecutionContext: domain.ExecutionContext{
			ContractVersion: domain.ToolRequestContractVersion,
			RequestID:       "req-test",
			WorkflowID:      "workflow:org-test:project:one",
			OrganizationID:  "org-test",
			ActorID:         "actor-test",
			PolicyVersion:   "policy-old",
			Capability:      "test-capability",
			Scope:           domain.Scope{IDs: []string{"team-test"}},
		},
		Tool:      "jira.project_tasks",
		Arguments: map[string]any{},
	}
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	httpRequest := httptest.NewRequest(http.MethodPost, "/v1/tools/invoke", bytes.NewReader(body))
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(response, httpRequest)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", response.Code, response.Body.String())
	}
}

func TestArtifactWriteReturnsTenantScopedReference(t *testing.T) {
	router := NewRouter(policy.NewAllowAllPolicy("policy-test"), slog.Default(), "test-token")
	body := `{"contractVersion":"artifact-write.v1","requestId":"artifact-req","workflowId":"workflow:org-test:project:one","organizationId":"org-test","actorId":"actor-test","policyVersion":"policy-test","capability":"test-capability","scope":{"ids":["team-test"]},"objectKey":"evidence/project.json","contentType":"application/json","dataRef":"provider:jira:project-1"}`
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/artifacts", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var result domain.ArtifactWriteResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "mocked" || result.ArtifactRef == "" || result.ObjectKey != "org-test/workflow:org-test:project:one/evidence/project.json" {
		t.Fatalf("unexpected artifact result: %+v", result)
	}
}

func TestMemoryArtifactStoreRejectsCrossOrganizationReads(t *testing.T) {
	store := newMemoryArtifactStore()
	writeRequest := domain.ArtifactWriteRequest{
		ExecutionContext: domain.ExecutionContext{OrganizationID: "organization-test", WorkflowID: "workflow:organization-test:fixture", ActorID: "actor", PolicyVersion: "policy", Scope: domain.Scope{IDs: []string{"root"}}},
		ObjectKey:        "evidence/project.json",
		ContentType:      "application/json",
		DataRef:          "organization-test-data",
	}
	written, err := store.Write(context.Background(), writeRequest)
	if err != nil {
		t.Fatalf("write local artifact: %v", err)
	}

	readRequest := domain.ArtifactReadRequest{ExecutionContext: writeRequest.ExecutionContext, ArtifactRef: written.ArtifactRef}
	if _, err := store.Read(context.Background(), readRequest); err != nil {
		t.Fatalf("same-organization artifact read failed: %v", err)
	}
	readRequest.ArtifactRef = "artifact://local/organization-test/source/r1"
	if _, err := store.Read(context.Background(), readRequest); err != nil {
		t.Fatalf("same-organization local fixture artifact read failed: %v", err)
	}
	readRequest.ArtifactRef = written.ArtifactRef
	readRequest.OrganizationID = "organization-avengers"
	readRequest.WorkflowID = "workflow:organization-avengers:fixture"
	if _, err := store.Read(context.Background(), readRequest); err == nil {
		t.Fatal("cross-organization artifact read was accepted")
	}
	readRequest.ArtifactRef = "artifact://memory/organizations/organization-test/unknown-reference"
	readRequest.OrganizationID = "organization-avengers"
	if _, err := store.Read(context.Background(), readRequest); err == nil {
		t.Fatal("unknown memory artifact reference was accepted as a fixture")
	}
}

func TestRouterAcceptsAnInjectedArtifactStore(t *testing.T) {
	store := &recordingArtifactStore{}
	router := NewRouterWithOptions(policy.NewAllowAllPolicy("policy-test"), slog.Default(), "test-token", RouterOptions{
		ArtifactStore: store,
	})
	body := `{"contractVersion":"artifact-write.v1","requestId":"artifact-adapter-req","workflowId":"workflow:org-test:project:one","organizationId":"org-test","actorId":"actor-test","policyVersion":"policy-test","capability":"test-capability","scope":{"ids":["team-test"]},"objectKey":"evidence/project.json","contentType":"application/json","dataRef":"provider:jira:project-1"}`
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/artifacts", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK || store.writes != 1 {
		t.Fatalf("expected injected artifact store to handle one request, got status=%d writes=%d: %s", response.Code, store.writes, response.Body.String())
	}
	var result domain.ArtifactWriteResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" || result.ArtifactRef != "gs://test-bucket/evidence/project.json" {
		t.Fatalf("unexpected injected artifact result: %+v", result)
	}
}

func TestGraphQueryUsesInjectedGraphStore(t *testing.T) {
	store := &recordingGraphStore{}
	router := NewRouterWithOptions(policy.NewAllowAllPolicy("policy-test"), slog.Default(), "test-token", RouterOptions{
		GraphStore: store,
	})
	body := `{"contractVersion":"graph-query.v1","requestId":"graph-req","workflowId":"workflow:org-test:project:one","organizationId":"org-test","actorId":"actor-test","policyVersion":"policy-test","capability":"test-capability","scope":{"ids":["team-test"]},"query":"project.related_entities","params":{"projectKey":"checkout"}}`
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/graph/query", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK || store.queries != 1 {
		t.Fatalf("expected injected graph store to handle one request, got status=%d queries=%d: %s", response.Code, store.queries, response.Body.String())
	}
	var result domain.GraphQueryResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" || len(result.Nodes) != 1 || len(result.Edges) != 1 {
		t.Fatalf("unexpected graph result: %+v", result)
	}
}

func TestGraphQueryUsesDefaultMockAdapter(t *testing.T) {
	router := NewRouter(policy.NewAllowAllPolicy("policy-test"), slog.Default(), "test-token")
	body := `{"contractVersion":"graph-query.v1","requestId":"graph-deferred","workflowId":"workflow:org-test:project:one","organizationId":"org-test","actorId":"actor-test","policyVersion":"policy-test","capability":"test-capability","scope":{"ids":["team-test"]},"query":"project.related_entities"}`
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/graph/query", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected default mock graph adapter to return 200, got %d: %s", response.Code, response.Body.String())
	}
}

func TestArtifactWriteRejectsPathTraversal(t *testing.T) {
	router := NewRouter(policy.NewAllowAllPolicy("policy-test"), slog.Default(), "test-token")
	body := `{"contractVersion":"artifact-write.v1","requestId":"artifact-req","workflowId":"workflow:org-test:project:one","organizationId":"org-test","actorId":"actor-test","policyVersion":"policy-test","capability":"test-capability","scope":{"ids":["team-test"]},"objectKey":"../../secret.json","contentType":"application/json","dataRef":"provider:jira:project-1"}`
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/artifacts", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
}

func TestToolBoundaryRequiresCanonicalScopeIDs(t *testing.T) {
	router := NewRouter(policy.NewAllowAllPolicy("policy-test"), slog.Default(), "test-token")
	body := `{"contractVersion":"tool-request.v1","requestId":"req-test","workflowId":"workflow:org-test:project:one","organizationId":"org-test","actorId":"actor-test","policyVersion":"policy-test","capability":"test-capability","scope":{"projectIds":["project-a"]},"tool":"jira.project_tasks","arguments":{}}`
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/tools/invoke", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for non-canonical scope, got %d: %s", response.Code, response.Body.String())
	}
}

func TestRejectsUnknownContractFields(t *testing.T) {
	router := NewRouter(policy.NewAllowAllPolicy("policy-test"), slog.Default(), "test-token")
	response := httptest.NewRecorder()
	httpRequest := httptest.NewRequest(http.MethodPost, "/v1/permissions/check", bytes.NewBufferString(`{"contractVersion":"authorization-check.v1","requestId":"req","organizationId":"org","resource":"jira","action":"read","unexpected":true}`))
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(response, httpRequest)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
}

func TestCreatesWorkflowBlueprintAndDerivesPermissions(t *testing.T) {
	router := NewRouter(policy.NewAllowAllPolicy("policy-test"), slog.Default(), "test-token")
	request := domain.WorkflowDefinitionRequest{
		ExecutionContext: domain.ExecutionContext{
			ContractVersion: domain.WorkflowDefinitionContractVersion,
			RequestID:       "req-workflow",
			OrganizationID:  "org-test",
		},
		Blueprint: domain.WorkflowBlueprint{
			ContractVersion: domain.WorkflowBlueprintContractVersion,
			BlueprintID:     "project-custom",
			Version:         "1.0.0",
			Name:            "Custom project check",
			WorkflowType:    "encois.user-blueprint.v1",
			Purpose:         "Run Jira and GitHub checks in parallel",
			Enabled:         true,
			Steps: []domain.WorkflowStep{
				{ID: "jira", Kind: "tool", Tool: "jira.project_tasks"},
				{ID: "github", Kind: "tool", Tool: "github.project_activity"},
				{ID: "email", Kind: "tool", Tool: "email.send", DependsOn: []string{"jira", "github"}},
			},
		},
	}
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	httpRequest := httptest.NewRequest(http.MethodPost, "/v1/workflows", bytes.NewReader(body))
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(response, httpRequest)

	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	var result domain.WorkflowDefinitionResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.WorkflowID == "" || len(result.Permissions) != 3 || result.TemporalWorkflowType != "encois.user-blueprint.v1" {
		t.Fatalf("unexpected workflow response: %+v", result)
	}
	if !result.Permissions[2].ApprovalRequired {
		t.Fatal("expected email permission to require approval")
	}
}

func TestRejectsWorkflowDependencyCycle(t *testing.T) {
	router := NewRouter(policy.NewAllowAllPolicy("policy-test"), slog.Default(), "test-token")
	body := `{"contractVersion":"workflow-definition.v1","requestId":"req-cycle","organizationId":"org-test","blueprint":{"contractVersion":"workflow-blueprint.v1","blueprintId":"cycle","version":"1.0.0","name":"Cycle","workflowType":"encois.user-blueprint.v1","purpose":"Detect cycles","enabled":true,"steps":[{"id":"a","kind":"tool","tool":"jira.project_tasks","dependsOn":["b"]},{"id":"b","kind":"tool","tool":"github.project_activity","dependsOn":["a"]}]}}`
	response := httptest.NewRecorder()
	httpRequest := httptest.NewRequest(http.MethodPost, "/v1/workflows/validate", bytes.NewBufferString(body))
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(response, httpRequest)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
}
