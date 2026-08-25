package server

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	contractschemas "github.com/andriishupta/encois/packages/contracts"
)

type staticCredentialResolver struct {
	credential ProviderCredential
}

func (r staticCredentialResolver) Resolve(context.Context, string, string, []string, string) (ProviderCredential, error) {
	return r.credential, nil
}

type staticCredentialStore struct {
	payload []byte
}

func (s staticCredentialStore) Read(context.Context, string) ([]byte, error) { return s.payload, nil }
func (s staticCredentialStore) Write(context.Context, string, []byte) error  { return nil }

type rotatingCredentialStore struct {
	payload []byte
	writes  int
}

func (s *rotatingCredentialStore) Read(context.Context, string) ([]byte, error) {
	return s.payload, nil
}
func (s *rotatingCredentialStore) Write(_ context.Context, _ string, payload []byte) error {
	s.payload = append([]byte(nil), payload...)
	s.writes++
	return nil
}

type recordingProviderHealthReporter struct {
	organizationID string
	integrationID  string
	status         ProviderHealthStatus
	lastError      string
}

func (r *recordingProviderHealthReporter) Report(_ context.Context, organizationID, integrationID string, status ProviderHealthStatus, lastError string) error {
	r.organizationID = organizationID
	r.integrationID = integrationID
	r.status = status
	r.lastError = lastError
	return nil
}

type providerRoundTripFunc func(*http.Request) (*http.Response, error)

func (f providerRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func jsonResponse(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestMockProviderToolRegistryUsesTheProductionToolEnvelope(t *testing.T) {
	registry := mockProviderToolRegistry{}
	for _, fixture := range []struct {
		tool      string
		arguments map[string]any
	}{
		{tool: "jira.project_tasks", arguments: map[string]any{"projectKey": "checkout"}},
		{tool: "github.project_activity", arguments: map[string]any{"repository": "acme/checkout"}},
		{tool: "github.repository_activity", arguments: map[string]any{"repository": "acme/checkout"}},
	} {
		result, err := registry.Invoke(context.Background(), domain.ToolInvocationRequest{
			ExecutionContext: domain.ExecutionContext{RequestID: "mock-envelope", OrganizationID: "org-test"},
			Tool:             fixture.tool,
			Arguments:        fixture.arguments,
		})
		if err != nil {
			t.Fatalf("mock tool %s failed: %v", fixture.tool, err)
		}
		response := domain.ToolInvocationResponse{
			ContractVersion: domain.ToolResultContractVersion,
			RequestID:       "mock-envelope",
			Tool:            fixture.tool,
			Status:          "completed",
			Data:            result.Data,
			EvidenceRefs:    result.EvidenceRefs,
			Provenance:      result.Provenance,
			Freshness:       result.Freshness,
		}
		if err := contractschemas.Validate(contractschemas.SchemaToolResult, response); err != nil {
			t.Fatalf("mock tool %s did not produce the production envelope: %v", fixture.tool, err)
		}
	}
}

func TestMockProviderToolRegistryChecksKnownProviderHealth(t *testing.T) {
	registry := mockProviderToolRegistry{}
	for _, provider := range []string{"github", "jira"} {
		if err := registry.Check(context.Background(), ProviderHealthCheckRequest{OrganizationID: "org-test", IntegrationID: "integration-test", Provider: provider}); err != nil {
			t.Fatalf("mock health check for %s failed: %v", provider, err)
		}
	}
	if err := registry.Check(context.Background(), ProviderHealthCheckRequest{OrganizationID: "org-test", IntegrationID: "integration-test", Provider: "unknown"}); err == nil {
		t.Fatal("expected unknown mock provider health check to fail")
	}
}

func statusResponse(status int) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(`{"error":"provider failure"}`)),
	}
}

func TestGCPProviderToolRegistryReadsGitHubWithoutReturningCredential(t *testing.T) {
	reporter := &recordingProviderHealthReporter{}
	client := &http.Client{Transport: providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Header.Get("Authorization") != "Bearer provider-token" {
			t.Fatalf("provider token was not sent to the provider")
		}
		if strings.Contains(request.URL.String(), "provider-token") {
			t.Fatalf("provider token leaked into provider URL")
		}
		switch {
		case strings.HasSuffix(request.URL.Path, "/pulls"):
			return jsonResponse(`[{"head":{"sha":"sha-1"}}]`), nil
		case strings.HasSuffix(request.URL.Path, "/commits"):
			return jsonResponse(`[{"sha":"sha-1"},{"sha":"sha-2"}]`), nil
		case strings.HasSuffix(request.URL.Path, "/check-runs"):
			return jsonResponse(`{"check_runs":[{"conclusion":"failure"},{"conclusion":"success"}]}`), nil
		default:
			t.Fatalf("unexpected GitHub URL: %s", request.URL.String())
			return nil, nil
		}
	})}
	registry := &gcpProviderToolRegistry{
		resolver: staticCredentialResolver{credential: ProviderCredential{IntegrationID: "integration-1", Provider: "github", CredentialRef: "secretmanager://projects/demo/secrets/github"}},
		secrets:  staticCredentialStore{payload: []byte(`{"access_token":"provider-token"}`)},
		health:   reporter,
		http:     client,
		clock:    func() time.Time { return time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC) },
	}

	result, err := registry.Invoke(context.Background(), domain.ToolInvocationRequest{
		ExecutionContext: domain.ExecutionContext{OrganizationID: "org-1"},
		Tool:             "github.project_activity",
		Arguments:        map[string]any{"input": map[string]any{"repository": "acme/checkout"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Data["openPullRequests"] != 1 || result.Data["failingChecks"] != 1 || result.Data["commitsSinceCutoff"] != 2 {
		t.Fatalf("unexpected GitHub result: %+v", result.Data)
	}
	if result.Data["access_token"] != nil {
		t.Fatalf("credential was returned in provider data: %+v", result.Data)
	}
	if result.EvidenceRefs[0] != "github://acme/checkout" {
		t.Fatalf("unexpected evidence reference: %+v", result.EvidenceRefs)
	}
	if result.Provenance == nil || result.Provenance.Source != "github" || result.Provenance.SourceRecordID != "acme/checkout" {
		t.Fatalf("expected GitHub provenance, got %+v", result.Provenance)
	}
	if reporter.organizationID != "org-1" || reporter.integrationID != "integration-1" || reporter.status != ProviderHealthActive {
		t.Fatalf("expected active provider health report, got %+v", reporter)
	}
}

func TestGCPProviderToolRegistryChecksGitHubHealth(t *testing.T) {
	reporter := &recordingProviderHealthReporter{}
	client := &http.Client{Transport: providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path != "/user" {
			t.Fatalf("unexpected GitHub health URL: %s", request.URL.String())
		}
		if request.Header.Get("Authorization") != "Bearer provider-token" {
			t.Fatalf("provider token was not sent to health probe")
		}
		return jsonResponse(`{"login":"acme-bot"}`), nil
	})}
	registry := &gcpProviderToolRegistry{
		resolver: staticCredentialResolver{credential: ProviderCredential{IntegrationID: "integration-1", Provider: "github", CredentialRef: "secretmanager://projects/demo/secrets/github"}},
		secrets:  staticCredentialStore{payload: []byte(`{"access_token":"provider-token"}`)},
		health:   reporter,
		http:     client,
	}

	if err := registry.Check(context.Background(), ProviderHealthCheckRequest{OrganizationID: "org-1", IntegrationID: "integration-1", Provider: "github"}); err != nil {
		t.Fatal(err)
	}
	if reporter.status != ProviderHealthActive || reporter.integrationID != "integration-1" {
		t.Fatalf("expected active provider health report, got %+v", reporter)
	}
}

func TestGCPProviderToolRegistryReportsReauthorizationOnProviderAuthFailure(t *testing.T) {
	reporter := &recordingProviderHealthReporter{}
	registry := &gcpProviderToolRegistry{
		resolver: staticCredentialResolver{credential: ProviderCredential{IntegrationID: "integration-2", Provider: "github", CredentialRef: "secretmanager://projects/demo/secrets/github"}},
		secrets:  staticCredentialStore{payload: []byte(`{"access_token":"expired-token"}`)},
		health:   reporter,
		http: &http.Client{Transport: providerRoundTripFunc(func(*http.Request) (*http.Response, error) {
			return statusResponse(http.StatusUnauthorized), nil
		})},
		clock: time.Now,
	}

	_, err := registry.Invoke(context.Background(), domain.ToolInvocationRequest{
		ExecutionContext: domain.ExecutionContext{OrganizationID: "org-1"},
		Tool:             "github.project_activity",
		Arguments:        map[string]any{"input": map[string]any{"repository": "acme/checkout"}},
	})
	if err == nil {
		t.Fatal("expected provider authentication failure")
	}
	if reporter.integrationID != "integration-2" || reporter.status != ProviderHealthReauth {
		t.Fatalf("expected needs_reauth provider health report, got %+v", reporter)
	}
}

func TestGCPProviderToolRegistryRefreshesProviderTokenAndRotatesSecretVersion(t *testing.T) {
	store := &rotatingCredentialStore{payload: []byte(`{"access_token":"expired-token","refresh_token":"refresh-token"}`)}
	reporter := &recordingProviderHealthReporter{}
	client := &http.Client{Transport: providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host == "oauth.example" {
			if request.Method != http.MethodPost || request.Header.Get("Authorization") == "" {
				t.Fatalf("expected authenticated OAuth refresh request")
			}
			return jsonResponse(`{"access_token":"refreshed-token","expires_in":3600}`), nil
		}
		if request.Header.Get("Authorization") != "Bearer refreshed-token" {
			return statusResponse(http.StatusUnauthorized), nil
		}
		switch {
		case strings.HasSuffix(request.URL.Path, "/pulls"):
			return jsonResponse(`[{"head":{"sha":"sha-1"}}]`), nil
		case strings.HasSuffix(request.URL.Path, "/commits"):
			return jsonResponse(`[{"sha":"sha-1"}]`), nil
		case strings.HasSuffix(request.URL.Path, "/check-runs"):
			return jsonResponse(`{"check_runs":[]}`), nil
		default:
			t.Fatalf("unexpected provider URL: %s", request.URL.String())
			return nil, nil
		}
	})}
	registry := &gcpProviderToolRegistry{
		resolver: staticCredentialResolver{credential: ProviderCredential{IntegrationID: "integration-refresh", Provider: "github", CredentialRef: "secretmanager://projects/demo/secrets/github"}},
		secrets:  store,
		health:   reporter,
		http:     client,
		clock:    func() time.Time { return time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC) },
		oauth: map[string]providerOAuthConfig{
			"github": {ClientID: "client", ClientSecret: "secret", TokenEndpoint: "https://oauth.example/token", TokenAuthMethod: "basic"},
		},
	}

	if _, err := registry.Invoke(context.Background(), domain.ToolInvocationRequest{
		ExecutionContext: domain.ExecutionContext{OrganizationID: "org-refresh"},
		Tool:             "github.project_activity",
		Arguments:        map[string]any{"input": map[string]any{"repository": "acme/checkout"}},
	}); err != nil {
		t.Fatal(err)
	}
	if store.writes != 1 || !strings.Contains(string(store.payload), "refreshed-token") {
		t.Fatalf("expected one rotated credential version, writes=%d payload=%s", store.writes, store.payload)
	}
	if reporter.status != ProviderHealthActive {
		t.Fatalf("expected active health after refresh, got %+v", reporter)
	}
}

func TestGCPProviderToolRegistryReadsJiraAccessibleResource(t *testing.T) {
	client := &http.Client{Transport: providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host != "api.atlassian.com" || !strings.Contains(request.URL.Path, "/ex/jira/cloud-1/rest/api/3/search") {
			t.Fatalf("unexpected Jira URL: %s", request.URL.String())
		}
		return jsonResponse(`{"total":3,"issues":[{"fields":{"status":{"name":"Done","statusCategory":{"key":"done"}}}},{"fields":{"status":{"name":"Blocked","statusCategory":{"key":"indeterminate"}}}}]}`), nil
	})}
	registry := &gcpProviderToolRegistry{
		resolver: staticCredentialResolver{credential: ProviderCredential{Provider: "jira", CredentialRef: "secretmanager://projects/demo/secrets/jira"}},
		secrets:  staticCredentialStore{payload: []byte(`{"access_token":"jira-token","accessible_resources":[{"id":"cloud-1"}]}`)},
		http:     client,
		clock:    time.Now,
	}

	result, err := registry.Invoke(context.Background(), domain.ToolInvocationRequest{
		ExecutionContext: domain.ExecutionContext{OrganizationID: "org-1"},
		Tool:             "jira.project_tasks",
		Arguments:        map[string]any{"input": map[string]any{"projectKey": "PAY"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Data["totalTasks"] != 3 || result.Data["completedTasks"] != 1 || result.Data["blockedTasks"] != 1 {
		t.Fatalf("unexpected Jira result: %+v", result.Data)
	}
}
