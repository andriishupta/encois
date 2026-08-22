package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"google.golang.org/api/idtoken"
)

type controlPlaneCredentialResolver struct {
	baseURL      string
	httpClient   *http.Client
	serviceToken string
	audience     string
}

func newControlPlaneCredentialResolver(baseURL, serviceToken, audience string) (*controlPlaneCredentialResolver, error) {
	if strings.TrimSpace(baseURL) == "" || strings.TrimSpace(serviceToken) == "" {
		return nil, fmt.Errorf("control-plane URL and service token are required for provider tools")
	}
	return &controlPlaneCredentialResolver{
		baseURL:      strings.TrimRight(baseURL, "/"),
		httpClient:   &http.Client{Timeout: 10 * time.Second},
		serviceToken: serviceToken,
		audience:     strings.TrimSpace(audience),
	}, nil
}

func (r *controlPlaneCredentialResolver) Resolve(ctx context.Context, organizationID, provider string, capabilities []string, integrationID string) (ProviderCredential, error) {
	payloadValue := map[string]any{"provider": provider, "capabilities": capabilities}
	if strings.TrimSpace(integrationID) != "" {
		payloadValue["integrationId"] = integrationID
	}
	payload, err := json.Marshal(payloadValue)
	if err != nil {
		return ProviderCredential{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, r.baseURL+"/api/v1/internal/integrations/credentials/resolve", bytes.NewReader(payload))
	if err != nil {
		return ProviderCredential{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Encois-Service-Token", r.serviceToken)
	request.Header.Set("X-Organization-ID", organizationID)
	request.Header.Set("X-Actor-ID", "agent-gateway")
	if r.audience != "" {
		tokenSource, err := idtoken.NewTokenSource(ctx, r.audience)
		if err != nil {
			return ProviderCredential{}, fmt.Errorf("create control-plane identity token source: %w", err)
		}
		token, err := tokenSource.Token()
		if err != nil {
			return ProviderCredential{}, fmt.Errorf("create control-plane identity token: %w", err)
		}
		request.Header.Set("Authorization", "Bearer "+token.AccessToken)
	}
	response, err := r.httpClient.Do(request)
	if err != nil {
		return ProviderCredential{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ProviderCredential{}, fmt.Errorf("control-plane credential resolver returned HTTP %d", response.StatusCode)
	}
	var envelope struct {
		Data ProviderCredential `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		return ProviderCredential{}, err
	}
	if envelope.Data.Provider == "" || envelope.Data.CredentialRef == "" {
		return ProviderCredential{}, ErrProviderCredential
	}
	return envelope.Data, nil
}

func (r *controlPlaneCredentialResolver) Report(ctx context.Context, organizationID, integrationID string, status ProviderHealthStatus, lastError string) error {
	fields := map[string]any{"integrationId": integrationID, "status": status}
	if strings.TrimSpace(lastError) != "" {
		fields["lastError"] = lastError
	}
	payload, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, r.baseURL+"/api/v1/internal/integrations/health", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Encois-Service-Token", r.serviceToken)
	request.Header.Set("X-Organization-ID", organizationID)
	request.Header.Set("X-Actor-ID", "agent-gateway")
	if r.audience != "" {
		tokenSource, err := idtoken.NewTokenSource(ctx, r.audience)
		if err != nil {
			return fmt.Errorf("create control-plane identity token source: %w", err)
		}
		token, err := tokenSource.Token()
		if err != nil {
			return fmt.Errorf("create control-plane identity token: %w", err)
		}
		request.Header.Set("Authorization", "Bearer "+token.AccessToken)
	}
	response, err := r.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("control-plane health reporter returned HTTP %d", response.StatusCode)
	}
	return nil
}
