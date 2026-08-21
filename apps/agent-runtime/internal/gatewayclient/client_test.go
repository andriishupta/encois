package gatewayclient

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestInvokeSendsScopedAuthenticatedToolRequest(t *testing.T) {
	client := New("http://agent-gateway.test", "test-token")
	client.httpClient.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Header.Get("Authorization") != "Bearer test-token" {
			t.Fatalf("missing service authorization header")
		}
		if request.Header.Get("X-Request-ID") != "request-test" || request.Header.Get("X-Trace-ID") != "trace-test" {
			t.Fatalf("missing correlation headers")
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		payload := string(body)
		for _, expected := range []string{`"workflowId":"workflow:org-test:project:one"`, `"organizationId":"org-test"`, `"projectKey":"checkout"`, `"arguments"`, `"scope"`} {
			if !strings.Contains(payload, expected) {
				t.Fatalf("request body does not contain %q: %s", expected, payload)
			}
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"contractVersion":"tool-result.v1","requestId":"request-test","tool":"jira.project_tasks","status":"mocked","data":{"ok":true}}`)),
			Header:     make(http.Header),
		}, nil
	})

	result, err := client.Invoke(context.Background(), ToolRequest{
		ContractVersion: "tool-request.v1",
		RequestID:       "request-test",
		TraceID:         "trace-test",
		WorkflowID:      "workflow:org-test:project:one",
		OrganizationID:  "org-test",
		ActorID:         "actor-test",
		PolicyVersion:   "policy-test",
		Scope:           map[string]any{"ids": []string{"team-test"}},
		Tool:            "jira.project_tasks",
		Arguments:       map[string]any{"projectKey": "checkout"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "mocked" {
		t.Fatalf("unexpected result: %+v", result)
	}
}
