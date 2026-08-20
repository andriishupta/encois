package server

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	"github.com/andriishupta/encois/apps/agent-gateway/internal/policy"
)

func TestMockToolInvocation(t *testing.T) {
	router := NewRouter(policy.NewAllowAllPolicy("policy-test"), slog.Default())
	request := domain.ToolInvocationRequest{
		ExecutionContext: domain.ExecutionContext{
			ContractVersion: domain.ToolRequestContractVersion,
			RequestID:       "req-test",
			OrganizationID:  "org-test",
		},
		Tool: "jira.release_tasks",
	}
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	httpRequest := httptest.NewRequest(http.MethodPost, "/v1/tools/invoke", bytes.NewReader(body))
	httpRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, httpRequest)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var result domain.ToolInvocationResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "mocked" || result.Data["completedTasks"] != float64(8) {
		t.Fatalf("unexpected mock result: %+v", result)
	}
}

func TestRejectsUnknownContractFields(t *testing.T) {
	router := NewRouter(policy.NewAllowAllPolicy("policy-test"), slog.Default())
	response := httptest.NewRecorder()
	httpRequest := httptest.NewRequest(http.MethodPost, "/v1/permissions/check", bytes.NewBufferString(`{"contractVersion":"authorization-check.v1","requestId":"req","organizationId":"org","resource":"jira","action":"read","unexpected":true}`))
	httpRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, httpRequest)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
}

func TestCreatesWorkflowBlueprintAndDerivesPermissions(t *testing.T) {
	router := NewRouter(policy.NewAllowAllPolicy("policy-test"), slog.Default())
	request := domain.WorkflowDefinitionRequest{
		ExecutionContext: domain.ExecutionContext{
			ContractVersion: domain.WorkflowDefinitionContractVersion,
			RequestID:       "req-workflow",
			OrganizationID:  "org-test",
		},
		Blueprint: domain.WorkflowBlueprint{
			ContractVersion: domain.WorkflowBlueprintContractVersion,
			BlueprintID:     "release-custom",
			Version:         "1.0.0",
			Name:            "Custom release check",
			WorkflowType:    "encois.user-blueprint.v1",
			Purpose:         "Run Jira and GitHub checks in parallel",
			Enabled:         true,
			Steps: []domain.WorkflowStep{
				{ID: "jira", Kind: "tool", Tool: "jira.release_tasks"},
				{ID: "github", Kind: "tool", Tool: "github.release_activity"},
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
	router := NewRouter(policy.NewAllowAllPolicy("policy-test"), slog.Default())
	body := `{"contractVersion":"workflow-definition.v1","requestId":"req-cycle","organizationId":"org-test","blueprint":{"contractVersion":"workflow-blueprint.v1","blueprintId":"cycle","version":"1.0.0","name":"Cycle","workflowType":"encois.user-blueprint.v1","steps":[{"id":"a","kind":"tool","tool":"jira.release_tasks","dependsOn":["b"]},{"id":"b","kind":"tool","tool":"github.release_activity","dependsOn":["a"]}]}}`
	response := httptest.NewRecorder()
	httpRequest := httptest.NewRequest(http.MethodPost, "/v1/workflows/validate", bytes.NewBufferString(body))
	httpRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, httpRequest)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
}
