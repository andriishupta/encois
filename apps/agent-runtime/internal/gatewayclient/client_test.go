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
			Body:       io.NopCloser(strings.NewReader(`{"contractVersion":"tool-result.v1","requestId":"request-test","tool":"jira.project_tasks","status":"completed","data":{"ok":true},"provenance":{"source":"jira","sourceRecordId":"checkout","observedAt":"2026-08-22T10:00:00Z"},"confidence":0.88}`)),
			Header:     make(http.Header),
		}, nil
	})

	result, err := client.Invoke(context.Background(), ToolRequest{
		ContractVersion:  "tool-request.v1",
		RequestID:        "request-test",
		TraceID:          "trace-test",
		WorkflowID:       "workflow:org-test:project:one",
		OrganizationID:   "org-test",
		ActorID:          "actor-test",
		PolicyVersion:    "policy-test",
		Capability:       "test-capability",
		Scope:            map[string]any{"ids": []string{"team-test"}},
		BlueprintID:      "project-context",
		BlueprintVersion: "1.0.0",
		AllowedTools:     []string{"jira.project_tasks"},
		Tool:             "jira.project_tasks",
		Arguments:        map[string]any{"projectKey": "checkout"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.Provenance == nil || result.Provenance.Source != "jira" || result.Provenance.SourceRecordID != "checkout" {
		t.Fatalf("expected Jira provenance, got %+v", result.Provenance)
	}
	if result.Confidence == nil || *result.Confidence != 0.88 {
		t.Fatalf("expected tool confidence, got %+v", result.Confidence)
	}
}

func TestQueryGraphValidatesAndDecodesGraphResult(t *testing.T) {
	client := New("http://agent-gateway.test", "test-token")
	client.httpClient.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path != "/v1/graph/query" {
			t.Fatalf("unexpected graph path %q", request.URL.Path)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), `"query":"release.blockers"`) {
			t.Fatalf("graph query was not sent: %s", body)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"contractVersion":"graph-query-result.v1","requestId":"graph-test","status":"completed","nodes":[{"id":"blocker-1","type":"blocker","properties":{"status":"blocked"}}],"edges":[],"evidenceRefs":["graph://organizations/org-test/queries/release.blockers"]}`)),
			Header:     make(http.Header),
		}, nil
	})

	result, err := client.QueryGraph(context.Background(), GraphQueryRequest{
		ContractVersion: "graph-query.v1",
		RequestID:       "graph-test",
		WorkflowID:      "workflow:org-test:release-1",
		OrganizationID:  "org-test",
		ActorID:         "actor-test",
		PolicyVersion:   "policy-test",
		Scope:           map[string]any{"ids": []string{"project-1"}},
		Capability:      "test-capability",
		Query:           "release.blockers",
		Params:          map[string]any{"limit": 10},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" || len(result.Nodes) != 1 || len(result.EvidenceRefs) != 1 {
		t.Fatalf("unexpected graph result: %+v", result)
	}
}
