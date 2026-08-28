package corecoordinator

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
	"google.golang.org/api/idtoken"
)

// Client is the narrow control-plane boundary used by Coordinator Activities.
// Implementations call the Gateway API; they must not connect to its database.
type Client interface {
	UpdateOnboardingStatus(context.Context, coordinator.OnboardingStatusUpdate) error
}

// HTTPClient is the Runtime-side adapter for the private Coordinator API.
// It supports the local application token and, when configured, a Cloud Run
// identity token for the hosted service-to-service boundary.
type HTTPClient struct {
	baseURL      string
	httpClient   *http.Client
	serviceToken string
	audience     string
}

func NewHTTPClient(baseURL, serviceToken string, audience ...string) *HTTPClient {
	serviceAudience := ""
	if len(audience) > 0 {
		serviceAudience = strings.TrimSpace(audience[0])
	}
	return &HTTPClient{
		baseURL:      strings.TrimRight(baseURL, "/"),
		httpClient:   &http.Client{Timeout: 30 * time.Second},
		serviceToken: serviceToken,
		audience:     serviceAudience,
	}
}

func (c *HTTPClient) UpdateOnboardingStatus(ctx context.Context, update coordinator.OnboardingStatusUpdate) error {
	if update.ContractVersion != coordinator.CoordinatorContractVersion || update.CoordinatorID == "" || update.OrganizationID == "" {
		return fmt.Errorf("onboarding status update is incomplete")
	}
	if update.Status != "ready" && update.Status != "failed" {
		return fmt.Errorf("unsupported onboarding status %q", update.Status)
	}
	_, err := doJSON[map[string]any](c, ctx, http.MethodPost, "/api/v1/internal/coordinator/onboarding-status", update, "onboarding-status:"+update.OrganizationID, update.CoordinatorID, update.OrganizationID, nil)
	return err
}

type responseEnvelope[T any] struct {
	Data T `json:"data"`
}

func doJSON[T any](client *HTTPClient, ctx context.Context, method, path string, payload any, requestID, actorID, organizationID string, traceID *string) (T, error) {
	var zero T
	if client == nil || client.baseURL == "" {
		return zero, fmt.Errorf("Coordinator API client is not configured")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return zero, fmt.Errorf("encode Coordinator API request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, method, client.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return zero, fmt.Errorf("create Coordinator API request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if client.serviceToken != "" {
		request.Header.Set("X-Encois-Service-Token", client.serviceToken)
	}
	if requestID != "" {
		request.Header.Set("X-Request-ID", requestID)
	}
	if actorID != "" {
		request.Header.Set("X-Actor-ID", actorID)
	}
	if organizationID != "" {
		request.Header.Set("X-Organization-ID", organizationID)
	}
	if traceID != nil && *traceID != "" {
		request.Header.Set("X-Trace-ID", *traceID)
	}
	if client.audience != "" {
		tokenSource, err := idtoken.NewTokenSource(ctx, client.audience)
		if err != nil {
			return zero, fmt.Errorf("create control-plane identity token source: %w", err)
		}
		token, err := tokenSource.Token()
		if err != nil {
			return zero, fmt.Errorf("create control-plane identity token: %w", err)
		}
		request.Header.Set("Authorization", "Bearer "+token.AccessToken)
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return zero, fmt.Errorf("call Coordinator API: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		return zero, fmt.Errorf("Coordinator API returned HTTP %d", response.StatusCode)
	}
	var envelope responseEnvelope[T]
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		return zero, fmt.Errorf("decode Coordinator API response: %w", err)
	}
	return envelope.Data, nil
}
