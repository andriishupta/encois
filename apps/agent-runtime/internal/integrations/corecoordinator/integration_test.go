package corecoordinator

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestHTTPClientSubmitsPlanThroughAuthenticatedInternalRoute(t *testing.T) {
	client := NewHTTPClient("http://gateway.test", "service-token")
	client.httpClient.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path != "/api/v1/internal/coordinator/plans" {
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
		if request.Header.Get("X-Encois-Service-Token") != "service-token" {
			t.Fatalf("missing service token")
		}
		if request.Header.Get("X-Organization-ID") != "org-test" || request.Header.Get("X-Actor-ID") != "coord-test" {
			t.Fatalf("missing tenant or actor headers")
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), `"planId":"plan-test"`) {
			t.Fatalf("plan body was not forwarded: %s", body)
		}
		return jsonResponse(http.StatusAccepted, `{"data":{"planId":"plan-test","accepted":true,"requiresApproval":true,"status":"proposed"}}`), nil
	})

	result, err := client.SubmitWorkflowChangePlan(context.Background(), coordinator.WorkflowChangePlan{
		ContractVersion: coordinator.WorkflowChangePlanVersion,
		PlanID:          "plan-test",
		CoordinatorID:   "coord-test",
		OrganizationID:  "org-test",
		ObservedAt:      "2026-08-20T16:00:00.000Z",
		Changes: []coordinator.WorkflowChange{{
			Kind:             coordinator.ChangeCreate,
			Reason:           "Create the approved test Blueprint.",
			RequiresApproval: true,
			Blueprint: &coordinator.WorkflowBlueprint{
				ContractVersion:  "workflow-blueprint.v1",
				BlueprintID:      "release-test",
				Version:          "1.0.0",
				Name:             "Release test",
				WorkflowType:     coordinator.DynamicWorkflowType,
				Purpose:          "Test the Coordinator boundary.",
				Enabled:          true,
				Steps:            []coordinator.WorkflowStep{{ID: "transform", Kind: "transform"}},
				RequiresApproval: true,
			},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Accepted || result.PlanID != "plan-test" || result.Status != "proposed" {
		t.Fatalf("unexpected submission result: %+v", result)
	}
}

func TestHTTPClientStartsApprovedBlueprintWithExecutionContext(t *testing.T) {
	client := NewHTTPClient("http://gateway.test", "service-token")
	client.httpClient.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path != "/api/v1/internal/coordinator/workflows" {
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
		if request.Header.Get("X-Request-ID") != "request-test" || request.Header.Get("X-Trace-ID") != "trace-test" {
			t.Fatalf("missing correlation headers")
		}
		return jsonResponse(http.StatusAccepted, `{"data":{"workflowId":"workflow:org-test:encois.dynamic.v1:release-test","runId":"run-test","status":"queued"}}`), nil
	})

	result, err := client.StartApprovedWorkflow(context.Background(), StartWorkflowRequest{
		RequestID:        "request-test",
		TraceID:          "trace-test",
		CoordinatorID:    "coord-test",
		OrganizationID:   "org-test",
		ActorID:          "coord-test",
		PolicyVersion:    "policy-test",
		Scope:            map[string]any{"ids": []string{"team-test"}},
		BlueprintID:      "release-test",
		BlueprintVersion: "1.0.0",
		Key:              "release-test",
		BusinessInput:    map[string]any{"releaseKey": "aug-30"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.WorkflowID == "" || result.Status != "queued" {
		t.Fatalf("unexpected workflow result: %+v", result)
	}
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
}
