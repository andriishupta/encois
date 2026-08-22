package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	contractschemas "github.com/andriishupta/encois/packages/contracts"
	"google.golang.org/api/secretmanager/v1"
)

var (
	ErrProviderToolUnavailable = errors.New("provider tool is not configured")
	ErrProviderCredential      = errors.New("provider credential is unavailable")
	ErrProviderReauthorization = errors.New("provider reauthorization is required")
)

type providerHTTPError struct {
	status int
}

func (e *providerHTTPError) Error() string { return fmt.Sprintf("provider returned HTTP %d", e.status) }

func providerRequiresReauthorization(err error) bool {
	var providerError *providerHTTPError
	return errors.As(err, &providerError) && (providerError.status == http.StatusUnauthorized || providerError.status == http.StatusForbidden)
}

// ProviderCredentialResolver resolves a logical provider capability at the
// private control-plane boundary. It never returns a raw credential.
type ProviderCredentialResolver interface {
	Resolve(context.Context, string, string, []string, string) (ProviderCredential, error)
}

type ProviderCredential struct {
	IntegrationID string `json:"integrationId"`
	Provider      string `json:"provider"`
	CredentialRef string `json:"credentialRef"`
}

type ProviderHealthStatus string

const (
	ProviderHealthActive   ProviderHealthStatus = "active"
	ProviderHealthDegraded ProviderHealthStatus = "degraded"
	ProviderHealthReauth   ProviderHealthStatus = "needs_reauth"
	ProviderHealthError    ProviderHealthStatus = "error"
)

type ProviderHealthReporter interface {
	Report(context.Context, string, string, ProviderHealthStatus, string) error
}

type ProviderHealthCheckRequest struct {
	OrganizationID string
	IntegrationID  string
	Provider       string
}

type ProviderCredentialStore interface {
	Read(context.Context, string) ([]byte, error)
	Write(context.Context, string, []byte) error
}

type providerOAuthConfig struct {
	ClientID        string `json:"clientId"`
	ClientSecret    string `json:"clientSecret"`
	TokenEndpoint   string `json:"tokenEndpoint"`
	TokenAuthMethod string `json:"tokenAuthMethod"`
}

type ProviderToolRegistry interface {
	Invoke(context.Context, domain.ToolInvocationRequest) (ProviderToolResult, error)
	Check(context.Context, ProviderHealthCheckRequest) error
	Status() string
	Ready() error
}

type ProviderToolResult struct {
	Data         map[string]any
	EvidenceRefs []string
	Freshness    []contractschemas.SourceFreshness
}

type mockProviderToolRegistry struct{}

func (mockProviderToolRegistry) Invoke(_ context.Context, request domain.ToolInvocationRequest) (ProviderToolResult, error) {
	data, evidenceRefs, freshness, ok := mockTool(request.Tool, request.OrganizationID)
	if !ok {
		return ProviderToolResult{}, ErrProviderToolUnavailable
	}
	return ProviderToolResult{Data: data, EvidenceRefs: evidenceRefs, Freshness: freshness}, nil
}

func (mockProviderToolRegistry) Status() string { return "mock-in-memory" }
func (mockProviderToolRegistry) Ready() error   { return nil }
func (mockProviderToolRegistry) Check(context.Context, ProviderHealthCheckRequest) error {
	return ErrProviderToolUnavailable
}

type gcpProviderToolRegistry struct {
	resolver ProviderCredentialResolver
	secrets  ProviderCredentialStore
	health   ProviderHealthReporter
	http     *http.Client
	clock    func() time.Time
	oauth    map[string]providerOAuthConfig
}

func newGCPProviderToolRegistry(resolver ProviderCredentialResolver, secrets ProviderCredentialStore, oauthConfigJSON string, reporters ...ProviderHealthReporter) (ProviderToolRegistry, error) {
	if resolver == nil || secrets == nil {
		return nil, fmt.Errorf("%w: control-plane credential resolver and Secret Manager store are required", ErrProviderToolUnavailable)
	}
	oauth, err := parseProviderOAuthConfig(oauthConfigJSON)
	if err != nil {
		return nil, err
	}
	var health ProviderHealthReporter
	if len(reporters) > 0 {
		health = reporters[0]
	}
	return &gcpProviderToolRegistry{
		resolver: resolver,
		secrets:  secrets,
		health:   health,
		http:     &http.Client{Timeout: 20 * time.Second},
		clock:    time.Now,
		oauth:    oauth,
	}, nil
}

func (r *gcpProviderToolRegistry) Status() string { return "gcp-provider-adapters" }

func (r *gcpProviderToolRegistry) Ready() error {
	if r == nil || r.resolver == nil || r.secrets == nil || r.http == nil {
		return ErrProviderToolUnavailable
	}
	return nil
}

func (r *gcpProviderToolRegistry) Invoke(ctx context.Context, request domain.ToolInvocationRequest) (ProviderToolResult, error) {
	provider, capabilities, ok := providerToolBinding(request.Tool)
	if !ok {
		return ProviderToolResult{}, fmt.Errorf("%w: %s", ErrProviderToolUnavailable, request.Tool)
	}
	credential, err := r.resolver.Resolve(ctx, request.OrganizationID, provider, capabilities, "")
	if err != nil {
		return ProviderToolResult{}, fmt.Errorf("resolve provider credential: %w", err)
	}
	secretBytes, err := r.secrets.Read(ctx, credential.CredentialRef)
	if err != nil {
		if errors.Is(err, ErrProviderCredential) {
			r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthReauth, "The provider credential is unavailable or invalid.")
		} else {
			r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthDegraded, "The provider credential store is unavailable.")
		}
		return ProviderToolResult{}, fmt.Errorf("read provider credential: %w", err)
	}
	var tokenSet map[string]any
	if err := json.Unmarshal(secretBytes, &tokenSet); err != nil {
		return ProviderToolResult{}, fmt.Errorf("decode provider credential: %w", err)
	}
	token, ok := tokenSetString(tokenSet, "access_token", "token")
	if !ok {
		r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthReauth, "The provider credential does not contain a usable access token.")
		return ProviderToolResult{}, ErrProviderReauthorization
	}
	if tokenSetExpired(tokenSet, r.now()) {
		refreshedToken, refreshErr := r.refreshAccessToken(ctx, credential, tokenSet)
		if refreshErr != nil {
			r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthReauth, "The provider access token expired and could not be refreshed.")
			return ProviderToolResult{}, fmt.Errorf("refresh provider credential: %w", refreshErr)
		}
		token = refreshedToken
	}
	input := providerInput(request.Arguments)
	var result ProviderToolResult
	result, err = r.invokeProvider(ctx, request, token, tokenSet, input)
	if providerRequiresReauthorization(err) {
		if refreshedToken, refreshErr := r.refreshAccessToken(ctx, credential, tokenSet); refreshErr == nil {
			result, err = r.invokeProvider(ctx, request, refreshedToken, tokenSet, input)
		}
	}
	if err != nil {
		if providerRequiresReauthorization(err) {
			r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthReauth, "The provider rejected the credential.")
			err = fmt.Errorf("%w: %v", ErrProviderReauthorization, err)
		} else if errors.Is(err, ErrProviderCredential) {
			r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthReauth, "The provider credential is unavailable or invalid.")
		} else if !errors.Is(err, ErrProviderToolUnavailable) {
			r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthDegraded, "The provider request failed.")
		}
		return ProviderToolResult{}, err
	}
	r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthActive, "")
	return result, nil
}

func (r *gcpProviderToolRegistry) invokeProvider(ctx context.Context, request domain.ToolInvocationRequest, token string, tokenSet map[string]any, input map[string]any) (ProviderToolResult, error) {
	switch request.Tool {
	case "github.project_activity", "github.repository_activity":
		return r.githubActivity(ctx, request, token, input)
	case "jira.project_tasks":
		return r.jiraProjectTasks(ctx, request, token, tokenSet, input)
	default:
		return ProviderToolResult{}, fmt.Errorf("%w: %s", ErrProviderToolUnavailable, request.Tool)
	}
}

func (r *gcpProviderToolRegistry) Check(ctx context.Context, request ProviderHealthCheckRequest) error {
	provider, capabilities, ok := providerHealthBinding(request.Provider)
	if !ok || strings.TrimSpace(request.OrganizationID) == "" || strings.TrimSpace(request.IntegrationID) == "" {
		return fmt.Errorf("%w: unsupported provider health check", ErrProviderToolUnavailable)
	}
	credential, err := r.resolver.Resolve(ctx, request.OrganizationID, provider, capabilities, request.IntegrationID)
	if err != nil {
		return fmt.Errorf("resolve provider credential: %w", err)
	}
	secretBytes, err := r.secrets.Read(ctx, credential.CredentialRef)
	if err != nil {
		if errors.Is(err, ErrProviderCredential) {
			r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthReauth, "The provider credential is unavailable or invalid.")
		} else {
			r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthDegraded, "The provider credential store is unavailable.")
		}
		return fmt.Errorf("read provider credential: %w", err)
	}
	var tokenSet map[string]any
	if err := json.Unmarshal(secretBytes, &tokenSet); err != nil {
		return fmt.Errorf("decode provider credential: %w", err)
	}
	token, ok := tokenSetString(tokenSet, "access_token", "token")
	if !ok {
		r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthReauth, "The provider credential does not contain a usable access token.")
		return ErrProviderReauthorization
	}

	if tokenSetExpired(tokenSet, r.now()) {
		refreshedToken, refreshErr := r.refreshAccessToken(ctx, credential, tokenSet)
		if refreshErr != nil {
			r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthReauth, "The provider access token expired and could not be refreshed.")
			return fmt.Errorf("refresh provider credential: %w", refreshErr)
		}
		token = refreshedToken
	}

	probeErr := r.probeProvider(ctx, provider, token, tokenSet)
	if providerRequiresReauthorization(probeErr) {
		if refreshedToken, refreshErr := r.refreshAccessToken(ctx, credential, tokenSet); refreshErr == nil {
			probeErr = r.probeProvider(ctx, provider, refreshedToken, tokenSet)
		}
	}
	if probeErr != nil {
		if providerRequiresReauthorization(probeErr) {
			r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthReauth, "The provider rejected the credential.")
			return fmt.Errorf("%w: %v", ErrProviderReauthorization, probeErr)
		}
		r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthDegraded, "The provider health probe failed.")
		return probeErr
	}
	r.reportHealth(ctx, request.OrganizationID, credential, ProviderHealthActive, "")
	return nil
}

func (r *gcpProviderToolRegistry) probeProvider(ctx context.Context, provider, token string, tokenSet map[string]any) error {
	switch provider {
	case "github":
		var profile map[string]any
		return r.getJSON(ctx, token, "https://api.github.com/user", &profile, map[string]string{
			"Accept":               "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		})
	case "jira":
		base, ok := jiraBaseURL(tokenSet)
		if !ok {
			return fmt.Errorf("Jira OAuth credential does not include an accessible cloud")
		}
		var profile map[string]any
		return r.getJSON(ctx, token, base+"/rest/api/3/myself", &profile, map[string]string{"Accept": "application/json"})
	default:
		return fmt.Errorf("%w: unsupported provider %s", ErrProviderToolUnavailable, provider)
	}
}

func (r *gcpProviderToolRegistry) reportHealth(ctx context.Context, organizationID string, credential ProviderCredential, status ProviderHealthStatus, message string) {
	if r.health == nil || credential.IntegrationID == "" {
		return
	}
	_ = r.health.Report(ctx, organizationID, credential.IntegrationID, status, message)
}

func (r *gcpProviderToolRegistry) now() time.Time {
	if r.clock != nil {
		return r.clock()
	}
	return time.Now()
}

func providerToolBinding(tool string) (string, []string, bool) {
	switch tool {
	case "github.project_activity", "github.repository_activity":
		return "github", []string{"code.read"}, true
	case "jira.project_tasks":
		return "jira", []string{"issues.read"}, true
	default:
		return "", nil, false
	}
}

func providerHealthBinding(provider string) (string, []string, bool) {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "github":
		return "github", []string{"code.read"}, true
	case "jira":
		return "jira", []string{"issues.read"}, true
	default:
		return "", nil, false
	}
}

func providerInput(arguments map[string]any) map[string]any {
	input := make(map[string]any)
	for key, value := range arguments {
		input[key] = value
	}
	for _, key := range []string{"input", "businessInput"} {
		if nested, ok := arguments[key].(map[string]any); ok {
			for nestedKey, value := range nested {
				input[nestedKey] = value
			}
		}
	}
	return input
}

func tokenSetString(values map[string]any, keys ...string) (string, bool) {
	for _, key := range keys {
		if value, ok := values[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value), true
		}
	}
	return "", false
}

func parseProviderOAuthConfig(raw string) (map[string]providerOAuthConfig, error) {
	if strings.TrimSpace(raw) == "" {
		return map[string]providerOAuthConfig{}, nil
	}
	var parsed map[string]providerOAuthConfig
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, fmt.Errorf("decode provider OAuth configuration: %w", err)
	}
	result := make(map[string]providerOAuthConfig, len(parsed))
	for provider, config := range parsed {
		provider = strings.ToLower(strings.TrimSpace(provider))
		if provider == "" || strings.TrimSpace(config.ClientID) == "" || strings.TrimSpace(config.ClientSecret) == "" || strings.TrimSpace(config.TokenEndpoint) == "" {
			return nil, fmt.Errorf("provider OAuth configuration for %q is incomplete", provider)
		}
		endpoint, err := url.Parse(config.TokenEndpoint)
		if err != nil || endpoint.Scheme != "https" || endpoint.Host == "" {
			return nil, fmt.Errorf("provider OAuth token endpoint for %q must use HTTPS", provider)
		}
		config.TokenAuthMethod = strings.ToLower(strings.TrimSpace(config.TokenAuthMethod))
		if config.TokenAuthMethod == "" {
			config.TokenAuthMethod = "basic"
		}
		if config.TokenAuthMethod != "basic" && config.TokenAuthMethod != "post" {
			return nil, fmt.Errorf("provider OAuth token auth method for %q is unsupported", provider)
		}
		result[provider] = config
	}
	return result, nil
}

func tokenSetNumber(values map[string]any, key string) (float64, bool) {
	value, ok := values[key]
	if !ok {
		return 0, false
	}
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	default:
		return 0, false
	}
}

func tokenSetExpired(values map[string]any, now time.Time) bool {
	if raw, ok := tokenSetString(values, "expires_at", "expiresAt"); ok {
		if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
			return !parsed.After(now.Add(30 * time.Second))
		}
		if unix, err := strconv.ParseInt(raw, 10, 64); err == nil {
			return !time.Unix(unix, 0).After(now.Add(30 * time.Second))
		}
	}
	obtained, ok := tokenSetString(values, "encois_token_obtained_at")
	expiresIn, expiresOK := tokenSetNumber(values, "expires_in")
	if !ok || !expiresOK || expiresIn <= 0 {
		return false
	}
	parsed, err := time.Parse(time.RFC3339, obtained)
	return err == nil && !parsed.Add(time.Duration(expiresIn*float64(time.Second))).After(now.Add(30*time.Second))
}

func (r *gcpProviderToolRegistry) refreshAccessToken(ctx context.Context, credential ProviderCredential, tokenSet map[string]any) (string, error) {
	config, configured := r.oauth[strings.ToLower(credential.Provider)]
	if !configured {
		return "", ErrProviderReauthorization
	}
	refreshToken, ok := tokenSetString(tokenSet, "refresh_token", "refreshToken")
	if !ok {
		return "", ErrProviderReauthorization
	}
	params := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {config.ClientID},
	}
	headers := map[string]string{
		"Accept":       "application/json",
		"Content-Type": "application/x-www-form-urlencoded",
	}
	if config.TokenAuthMethod == "basic" {
		headers["Authorization"] = "Basic " + base64.StdEncoding.EncodeToString([]byte(config.ClientID+":"+config.ClientSecret))
	} else {
		params.Set("client_secret", config.ClientSecret)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, config.TokenEndpoint, strings.NewReader(params.Encode()))
	if err != nil {
		return "", err
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := r.http.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", &providerHTTPError{status: response.StatusCode}
	}
	var refreshed map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&refreshed); err != nil {
		return "", err
	}
	accessToken, ok := tokenSetString(refreshed, "access_token", "token")
	if !ok {
		return "", ErrProviderReauthorization
	}
	if _, hasRefreshToken := tokenSetString(refreshed, "refresh_token", "refreshToken"); !hasRefreshToken {
		refreshed["refresh_token"] = refreshToken
	}
	refreshed["encois_token_obtained_at"] = r.now().UTC().Format(time.RFC3339)
	payload, err := json.Marshal(refreshed)
	if err != nil {
		return "", err
	}
	if err := r.secrets.Write(ctx, credential.CredentialRef, payload); err != nil {
		return "", fmt.Errorf("rotate provider credential version: %w", err)
	}
	return accessToken, nil
}

func stringInput(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (r *gcpProviderToolRegistry) githubActivity(ctx context.Context, request domain.ToolInvocationRequest, token string, input map[string]any) (ProviderToolResult, error) {
	repository := stringInput(input, "repository", "repositoryFullName", "repo", "projectKey")
	parts := strings.Split(repository, "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return ProviderToolResult{}, fmt.Errorf("github repository must use owner/name format")
	}
	owner, name := url.PathEscape(parts[0]), url.PathEscape(parts[1])
	base := "https://api.github.com/repos/" + owner + "/" + name
	pulls := make([]struct {
		Head struct {
			SHA string `json:"sha"`
		} `json:"head"`
	}, 0)
	if err := r.getJSON(ctx, token, base+"/pulls?state=open&per_page=100", &pulls, map[string]string{"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}); err != nil {
		return ProviderToolResult{}, fmt.Errorf("read GitHub pull requests: %w", err)
	}
	commits := make([]struct {
		SHA string `json:"sha"`
	}, 0)
	commitURL := base + "/commits?per_page=100"
	if since := stringInput(input, "since", "cutoff", "sinceAt"); since != "" {
		commitURL += "&since=" + url.QueryEscape(since)
	}
	if err := r.getJSON(ctx, token, commitURL, &commits, map[string]string{"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}); err != nil {
		return ProviderToolResult{}, fmt.Errorf("read GitHub commits: %w", err)
	}
	failingChecks := 0
	for index, pull := range pulls {
		if index >= 20 || pull.Head.SHA == "" {
			break
		}
		var checks struct {
			CheckRuns []struct {
				Conclusion string `json:"conclusion"`
			} `json:"check_runs"`
		}
		if err := r.getJSON(ctx, token, base+"/commits/"+url.PathEscape(pull.Head.SHA)+"/check-runs", &checks, map[string]string{"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}); err != nil {
			return ProviderToolResult{}, fmt.Errorf("read GitHub checks: %w", err)
		}
		for _, check := range checks.CheckRuns {
			if check.Conclusion != "" && check.Conclusion != "success" && check.Conclusion != "neutral" && check.Conclusion != "skipped" {
				failingChecks++
			}
		}
	}
	now := r.now().UTC().Format(time.RFC3339)
	return ProviderToolResult{
		Data: map[string]any{
			"source":             "github",
			"organizationId":     request.OrganizationID,
			"projectId":          repository,
			"openPullRequests":   len(pulls),
			"failingChecks":      failingChecks,
			"commitsSinceCutoff": len(commits),
			"observedAt":         now,
		},
		EvidenceRefs: []string{"github://" + repository},
		Freshness:    []contractschemas.SourceFreshness{{Source: "github", ObservedAt: now, IngestedAt: now, Status: contractschemas.FreshnessFresh}},
	}, nil
}

func (r *gcpProviderToolRegistry) jiraProjectTasks(ctx context.Context, request domain.ToolInvocationRequest, token string, tokenSet map[string]any, input map[string]any) (ProviderToolResult, error) {
	projectKey := stringInput(input, "projectKey", "project", "projectId")
	if projectKey == "" || strings.ContainsAny(projectKey, "\r\n") {
		return ProviderToolResult{}, fmt.Errorf("Jira projectKey is required")
	}
	base, ok := jiraBaseURL(tokenSet)
	if !ok {
		return ProviderToolResult{}, fmt.Errorf("Jira OAuth credential does not include an accessible cloud")
	}
	query := url.Values{}
	query.Set("jql", "project = \""+strings.ReplaceAll(projectKey, `"`, ``)+`" ORDER BY updated DESC`)
	query.Set("maxResults", "100")
	query.Set("fields", "status")
	var result struct {
		Total  int `json:"total"`
		Issues []struct {
			Fields struct {
				Status struct {
					Name           string `json:"name"`
					StatusCategory struct {
						Key string `json:"key"`
					} `json:"statusCategory"`
				} `json:"status"`
			} `json:"fields"`
		} `json:"issues"`
	}
	if err := r.getJSON(ctx, token, base+"/rest/api/3/search?"+query.Encode(), &result, map[string]string{"Accept": "application/json"}); err != nil {
		return ProviderToolResult{}, fmt.Errorf("read Jira tasks: %w", err)
	}
	completed, blocked := 0, 0
	for _, issue := range result.Issues {
		category := strings.ToLower(issue.Fields.Status.StatusCategory.Key)
		name := strings.ToLower(issue.Fields.Status.Name)
		if category == "done" {
			completed++
		}
		if strings.Contains(name, "block") || strings.Contains(name, "imped") {
			blocked++
		}
	}
	now := r.now().UTC().Format(time.RFC3339)
	return ProviderToolResult{
		Data: map[string]any{
			"source":         "jira",
			"organizationId": request.OrganizationID,
			"projectId":      projectKey,
			"totalTasks":     result.Total,
			"completedTasks": completed,
			"remainingTasks": result.Total - completed,
			"blockedTasks":   blocked,
			"observedAt":     now,
		},
		EvidenceRefs: []string{"jira://project/" + url.PathEscape(projectKey)},
		Freshness:    []contractschemas.SourceFreshness{{Source: "jira", ObservedAt: now, IngestedAt: now, Status: contractschemas.FreshnessFresh}},
	}, nil
}

func jiraBaseURL(tokenSet map[string]any) (string, bool) {
	if value, ok := tokenSetString(tokenSet, "api_base_url", "apiBaseUrl"); ok && strings.HasPrefix(value, "https://") {
		return strings.TrimRight(value, "/"), true
	}
	if cloudID, ok := tokenSetString(tokenSet, "cloud_id", "cloudId"); ok {
		return "https://api.atlassian.com/ex/jira/" + url.PathEscape(cloudID), true
	}
	if resources, ok := tokenSet["accessible_resources"].([]any); ok {
		for _, raw := range resources {
			resource, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			if cloudID, ok := tokenSetString(resource, "id"); ok {
				return "https://api.atlassian.com/ex/jira/" + url.PathEscape(cloudID), true
			}
		}
	}
	return "", false
}

func (r *gcpProviderToolRegistry) getJSON(ctx context.Context, token, endpoint string, target any, headers map[string]string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := r.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4<<10))
		return &providerHTTPError{status: response.StatusCode}
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 4<<20))
	if err := decoder.Decode(target); err != nil {
		return err
	}
	return nil
}

type secretManagerCredentialStore struct {
	service   *secretmanager.Service
	projectID string
}

func newSecretManagerCredentialStore(ctx context.Context, projectID string) (ProviderCredentialStore, error) {
	if strings.TrimSpace(projectID) == "" {
		return nil, fmt.Errorf("Google Cloud project is required for provider credentials")
	}
	service, err := secretmanager.NewService(ctx)
	if err != nil {
		return nil, fmt.Errorf("create Secret Manager client: %w", err)
	}
	return &secretManagerCredentialStore{service: service, projectID: projectID}, nil
}

func (s *secretManagerCredentialStore) Read(ctx context.Context, reference string) ([]byte, error) {
	pathValue, err := s.secretPath(reference)
	if err != nil {
		return nil, err
	}
	name := pathValue + "/versions/latest"
	access, err := s.service.Projects.Secrets.Versions.Access(name).Context(ctx).Do()
	if err != nil {
		return nil, err
	}
	if access.Payload == nil || len(access.Payload.Data) == 0 {
		return nil, ErrProviderCredential
	}
	decoded, err := base64.StdEncoding.DecodeString(access.Payload.Data)
	if err != nil {
		return nil, fmt.Errorf("decode Secret Manager payload: %w", err)
	}
	return decoded, nil
}

func (s *secretManagerCredentialStore) Write(ctx context.Context, reference string, payload []byte) error {
	pathValue, err := s.secretPath(reference)
	if err != nil {
		return err
	}
	_, err = s.service.Projects.Secrets.AddVersion(pathValue, &secretmanager.AddSecretVersionRequest{
		Payload: &secretmanager.SecretPayload{Data: base64.StdEncoding.EncodeToString(payload)},
	}).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("add provider credential version: %w", err)
	}
	return nil
}

func (s *secretManagerCredentialStore) secretPath(reference string) (string, error) {
	const prefix = "secretmanager://projects/"
	if !strings.HasPrefix(reference, prefix) {
		return "", fmt.Errorf("unsupported credential reference")
	}
	pathValue := strings.TrimPrefix(reference, "secretmanager://")
	parts := strings.Split(pathValue, "/")
	if len(parts) != 4 || parts[0] != "projects" || parts[2] != "secrets" || parts[1] != s.projectID || parts[3] == "" || strings.ContainsAny(parts[3], "\r\n") {
		return "", fmt.Errorf("credential reference is outside the configured project")
	}
	return pathValue, nil
}
