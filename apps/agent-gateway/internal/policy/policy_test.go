package policy

import (
	"context"
	"testing"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
)

func policyTestRequest() domain.AuthorizationRequest {
	return domain.AuthorizationRequest{
		ExecutionContext: domain.ExecutionContext{
			ContractVersion: domain.ToolRequestContractVersion,
			RequestID:       "request-policy-test",
			WorkflowID:      "workflow:org-policy:release-1",
			OrganizationID:  "org-policy",
			ActorID:         "actor-policy",
			PolicyVersion:   "policy-read-only-v1",
			Scope:           domain.Scope{IDs: []string{"team-platform"}},
		},
	}
}

func TestReadOnlyToolPolicyPermissionMatrix(t *testing.T) {
	service := NewReadOnlyToolPolicy("policy-read-only-v1")
	tests := []struct {
		name     string
		mutate   func(*domain.AuthorizationRequest)
		allowed  bool
		decision string
	}{
		{name: "allowlisted jira read tool", mutate: func(request *domain.AuthorizationRequest) {
			request.Action = "invoke_tool"
			request.Resource = "jira.project_tasks"
		}, allowed: true, decision: "allow"},
		{name: "allowlisted github read tool", mutate: func(request *domain.AuthorizationRequest) {
			request.Action = "invoke_tool"
			request.Resource = "github.project_activity"
		}, allowed: true, decision: "allow"},
		{name: "unknown tool denied", mutate: func(request *domain.AuthorizationRequest) {
			request.Action = "invoke_tool"
			request.Resource = "email.send"
		}, allowed: false, decision: "deny"},
		{name: "graph read allowed", mutate: func(request *domain.AuthorizationRequest) {
			request.Action = "read"
			request.Resource = "spanner.graph"
		}, allowed: true, decision: "allow"},
		{name: "graph write facts allowed by explicit data-plane policy", mutate: func(request *domain.AuthorizationRequest) {
			request.Action = "write_facts"
			request.Resource = "spanner.graph"
		}, allowed: true, decision: "allow"},
		{name: "artifact read allowed", mutate: func(request *domain.AuthorizationRequest) {
			request.Action = "read_artifact"
			request.Resource = "cloud-storage"
		}, allowed: true, decision: "allow"},
		{name: "artifact write allowed by explicit data-plane policy", mutate: func(request *domain.AuthorizationRequest) {
			request.Action = "write_artifact"
			request.Resource = "cloud-storage"
		}, allowed: true, decision: "allow"},
		{name: "arbitrary action denied", mutate: func(request *domain.AuthorizationRequest) {
			request.Action = "delete"
			request.Resource = "spanner.graph"
		}, allowed: false, decision: "deny"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := policyTestRequest()
			test.mutate(&request)
			response := service.Authorize(context.Background(), request)
			if response.Allowed != test.allowed || response.Decision != test.decision {
				t.Fatalf("unexpected policy response: %+v", response)
			}
			if response.ContractVersion != domain.AuthorizationContractVersion || response.RequestID != request.RequestID || response.PolicyVersion != "policy-read-only-v1" {
				t.Fatalf("policy response lost contract identity: %+v", response)
			}
		})
	}
}

func TestReadOnlyToolPolicyFailsClosedForIncompleteOrMismatchedContext(t *testing.T) {
	service := NewReadOnlyToolPolicy("policy-read-only-v1")
	tests := []struct {
		name   string
		mutate func(*domain.AuthorizationRequest)
	}{
		{name: "missing organization", mutate: func(request *domain.AuthorizationRequest) { request.OrganizationID = "" }},
		{name: "missing workflow", mutate: func(request *domain.AuthorizationRequest) { request.WorkflowID = "" }},
		{name: "missing actor", mutate: func(request *domain.AuthorizationRequest) { request.ActorID = "" }},
		{name: "wrong policy version", mutate: func(request *domain.AuthorizationRequest) { request.PolicyVersion = "policy-other-v1" }},
		{name: "empty scope", mutate: func(request *domain.AuthorizationRequest) { request.Scope = domain.Scope{} }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := policyTestRequest()
			request.Action = "invoke_tool"
			request.Resource = "jira.project_tasks"
			test.mutate(&request)
			response := service.Authorize(context.Background(), request)
			if response.Allowed || response.Decision != "deny" || response.Reason == "" {
				t.Fatalf("incomplete context was not denied: %+v", response)
			}
		})
	}
}

func TestAllowAllPolicyIsExplicitlyTestOnly(t *testing.T) {
	service := NewAllowAllPolicy("test-policy")
	response := service.Authorize(context.Background(), domain.AuthorizationRequest{Resource: "email.send", Action: "invoke_tool"})
	if !response.Allowed || response.Decision != "allow" || response.PolicyVersion != "test-policy" {
		t.Fatalf("unexpected explicit test policy response: %+v", response)
	}
}
