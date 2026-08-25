package server

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	"github.com/andriishupta/encois/apps/agent-gateway/internal/policy"
)

func signedTestCapability(t *testing.T, secret string, execution domain.ExecutionContext, now time.Time) string {
	t.Helper()
	header, err := json.Marshal(executionCapabilityHeader{Algorithm: "HS256", Type: executionCapabilityVersion})
	if err != nil {
		t.Fatal(err)
	}
	claims, err := json.Marshal(executionCapabilityClaims{
		Version:       executionCapabilityVersion,
		Audience:      executionCapabilityAudience,
		Organization:  execution.OrganizationID,
		Workflow:      execution.WorkflowID,
		Actor:         execution.ActorID,
		PolicyVersion: execution.PolicyVersion,
		ScopeIDs:      append([]string(nil), execution.Scope.IDs...),
		IssuedAt:      now.Add(-time.Second).Unix(),
		ExpiresAt:     now.Add(time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	headerPart := base64.RawURLEncoding.EncodeToString(header)
	claimsPart := base64.RawURLEncoding.EncodeToString(claims)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(headerPart + "." + claimsPart))
	return headerPart + "." + claimsPart + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func capabilityTestContext() domain.ExecutionContext {
	return domain.ExecutionContext{
		ContractVersion: domain.ToolRequestContractVersion,
		RequestID:       "req-capability-test",
		WorkflowID:      "workflow:org-test:release-readiness:one",
		OrganizationID:  "org-test",
		ActorID:         "actor-test",
		PolicyVersion:   "policy-test",
		Scope:           domain.Scope{IDs: []string{"unit-platform"}},
	}
}

func TestExecutionCapabilityBindsExecutionContextAndScope(t *testing.T) {
	secret := "test-capability-secret"
	now := time.Now()
	execution := capabilityTestContext()
	execution.Capability = signedTestCapability(t, secret, execution, now)

	if err := verifyExecutionCapability(execution.Capability, secret, execution, now); err != nil {
		t.Fatalf("valid capability rejected: %v", err)
	}

	execution.Scope.IDs = []string{"unit-other"}
	if err := verifyExecutionCapability(execution.Capability, secret, execution, now); err == nil {
		t.Fatal("scope change was accepted by a capability bound to a different scope")
	}

	execution = capabilityTestContext()
	execution.Capability = signedTestCapability(t, secret, execution, now)
	execution.OrganizationID = "org-other"
	if err := verifyExecutionCapability(execution.Capability, secret, execution, now); err == nil {
		t.Fatal("organization change was accepted by a capability bound to a different organization")
	}

	execution = capabilityTestContext()
	execution.WorkflowID = "workflow:org-other:release-readiness:one"
	execution.Capability = signedTestCapability(t, secret, execution, now)
	if err := verifyExecutionCapability(execution.Capability, secret, execution, now); err == nil {
		t.Fatal("a validly signed workflow ID outside the organization prefix was accepted")
	}
}

func TestExecutionCapabilityRejectsEveryContextMutation(t *testing.T) {
	secret := "test-capability-secret"
	now := time.Now()
	base := capabilityTestContext()
	capability := signedTestCapability(t, secret, base, now)

	tests := []struct {
		name   string
		mutate func(*domain.ExecutionContext)
	}{
		{name: "organization", mutate: func(execution *domain.ExecutionContext) { execution.OrganizationID = "org-other" }},
		{name: "workflow", mutate: func(execution *domain.ExecutionContext) { execution.WorkflowID = "workflow:org-test:other" }},
		{name: "actor", mutate: func(execution *domain.ExecutionContext) { execution.ActorID = "actor-other" }},
		{name: "policy version", mutate: func(execution *domain.ExecutionContext) { execution.PolicyVersion = "policy-other" }},
		{name: "scope", mutate: func(execution *domain.ExecutionContext) { execution.Scope.IDs = []string{"unit-other"} }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			execution := base
			execution.Capability = capability
			test.mutate(&execution)
			if err := verifyExecutionCapability(execution.Capability, secret, execution, now); err == nil {
				t.Fatal("capability remained valid after execution context mutation")
			}
		})
	}
}

func TestExecutionCapabilityRejectsWrongSecretAndInvalidLifetime(t *testing.T) {
	secret := "test-capability-secret"
	now := time.Now()
	execution := capabilityTestContext()

	if err := verifyExecutionCapability(signedTestCapability(t, secret, execution, now), "wrong-secret", execution, now); err == nil {
		t.Fatal("capability signed by another gateway secret was accepted")
	}

	for _, test := range []struct {
		name     string
		issuedAt time.Time
		verifyAt time.Time
	}{
		{name: "expired", issuedAt: now.Add(-2 * time.Minute), verifyAt: now},
		{name: "issued in future", issuedAt: now, verifyAt: now.Add(-2 * time.Minute)},
	} {
		t.Run(test.name, func(t *testing.T) {
			capability := signedTestCapability(t, secret, execution, test.issuedAt)
			if err := verifyExecutionCapability(capability, secret, execution, test.verifyAt); err == nil {
				t.Fatal("capability with invalid lifetime was accepted")
			}
		})
	}
}

func TestConfiguredRouterRejectsMissingOrMismatchedCapability(t *testing.T) {
	secret := "test-capability-secret"
	now := time.Now()
	execution := capabilityTestContext()
	execution.Capability = signedTestCapability(t, secret, execution, now)
	request := domain.ToolInvocationRequest{
		ExecutionContext: execution,
		BlueprintID:      "project-context",
		BlueprintVersion: "1.0.0",
		AllowedTools:     []string{"jira.project_tasks"},
		Tool:             "jira.project_tasks",
		Arguments:        map[string]any{"projectKey": "checkout"},
	}
	router := NewRouterWithOptions(policy.NewAllowAllPolicy("policy-test"), slog.Default(), "test-token", RouterOptions{
		CapabilitySecret:  secret,
		RequireCapability: true,
		ProviderTools:     mockProviderToolRegistry{},
	})

	invoke := func(input domain.ToolInvocationRequest) *httptest.ResponseRecorder {
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		httpRequest := httptest.NewRequest(http.MethodPost, "/v1/tools/invoke", bytes.NewReader(body))
		httpRequest.Header.Set("Content-Type", "application/json")
		httpRequest.Header.Set("Authorization", "Bearer test-token")
		router.ServeHTTP(response, httpRequest)
		return response
	}

	if response := invoke(request); response.Code != http.StatusOK {
		t.Fatalf("valid capability rejected: %d: %s", response.Code, response.Body.String())
	}

	request.ExecutionContext.Scope.IDs = []string{"unit-other"}
	if response := invoke(request); response.Code != http.StatusForbidden {
		t.Fatalf("mismatched scope was not denied: %d: %s", response.Code, response.Body.String())
	}

	request = domain.ToolInvocationRequest{
		ExecutionContext: capabilityTestContext(),
		BlueprintID:      "project-context",
		BlueprintVersion: "1.0.0",
		AllowedTools:     []string{"jira.project_tasks"},
		Tool:             "jira.project_tasks",
		Arguments:        map[string]any{"projectKey": "checkout"},
	}
	if response := invoke(request); response.Code != http.StatusBadRequest {
		t.Fatalf("missing capability was not rejected at the contract boundary: %d: %s", response.Code, response.Body.String())
	}
}
