package gatewayclient

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func securityToolRequest() ToolRequest {
	return ToolRequest{
		ContractVersion:  "tool-request.v1",
		RequestID:        "request-gateway-security",
		WorkflowID:       "workflow:org-security:release-1",
		OrganizationID:   "org-security",
		ActorID:          "actor-security",
		PolicyVersion:    "policy-read-only-v1",
		Scope:            map[string]any{"ids": []string{"team-platform"}},
		Capability:       "capability-bound-to-org-security",
		BlueprintID:      "security-boundary",
		BlueprintVersion: "1.0.0",
		AllowedTools:     []string{"jira.project_tasks"},
		Tool:             "jira.project_tasks",
		Arguments:        map[string]any{"projectKey": "checkout"},
	}
}

func TestGatewayClientDoesNotCallGatewayWithoutTheConfiguredServiceToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer runtime-token" {
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(response, `{"contractVersion":"tool-result.v1","requestId":"request-gateway-security","tool":"jira.project_tasks","status":"completed"}`)
	}))
	defer server.Close()

	for _, token := range []string{"", "wrong-runtime-token"} {
		t.Run("token="+token, func(t *testing.T) {
			client := New(server.URL, token)
			if _, err := client.Invoke(context.Background(), securityToolRequest()); err == nil || !strings.Contains(err.Error(), "HTTP 401") {
				t.Fatalf("expected unauthorized gateway response for token %q, got %v", token, err)
			}
		})
	}
}

func TestGatewayClientRejectsResponseBoundToAnotherRequestOrTool(t *testing.T) {
	tests := []struct {
		name     string
		response string
	}{
		{name: "different request", response: `{"contractVersion":"tool-result.v1","requestId":"other-request","tool":"jira.project_tasks","status":"completed"}`},
		{name: "different tool", response: `{"contractVersion":"tool-result.v1","requestId":"request-gateway-security","tool":"github.project_activity","status":"completed"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(response, test.response)
			}))
			defer server.Close()

			client := New(server.URL, "runtime-token")
			if _, err := client.Invoke(context.Background(), securityToolRequest()); err == nil || !strings.Contains(err.Error(), "bound to a different") {
				t.Fatalf("expected response binding failure, got %v", err)
			}
		})
	}
}

func TestGatewayClientRejectsInvalidRequestBeforeNetwork(t *testing.T) {
	called := false
	client := New("http://gateway.invalid", "runtime-token")
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		called = true
		return nil, nil
	})
	request := securityToolRequest()
	request.OrganizationID = ""
	if _, err := client.Invoke(context.Background(), request); err == nil {
		t.Fatal("invalid tenant context was sent to the gateway")
	}
	if called {
		t.Fatal("invalid gateway request reached the network")
	}
}

func TestGatewayClientRejectsGraphResponseBoundToAnotherRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(response, `{"contractVersion":"graph-query-result.v1","requestId":"other-request","status":"completed","nodes":[],"edges":[]}`)
	}))
	defer server.Close()

	client := New(server.URL, "runtime-token")
	request := GraphQueryRequest{
		ContractVersion: "graph-query.v1", RequestID: "graph-security", WorkflowID: "workflow:org-security:release-1",
		OrganizationID: "org-security", ActorID: "actor-security", PolicyVersion: "policy-read-only-v1",
		Scope: map[string]any{"ids": []string{"team-platform"}}, Capability: "capability-bound-to-org-security", Query: "release.blockers",
	}
	if _, err := client.QueryGraph(context.Background(), request); err == nil || !strings.Contains(err.Error(), "bound to a different request") {
		t.Fatalf("expected graph response binding failure, got %v", err)
	}
}
