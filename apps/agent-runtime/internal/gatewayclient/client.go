package gatewayclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	contractschemas "github.com/andriishupta/encois/packages/contracts"
	"google.golang.org/api/idtoken"
)

type Client struct {
	baseURL      string
	httpClient   *http.Client
	serviceToken string
	audience     string
}

type ToolRequest struct {
	ContractVersion string         `json:"contractVersion"`
	RequestID       string         `json:"requestId"`
	TraceID         string         `json:"traceId,omitempty"`
	WorkflowID      string         `json:"workflowId"`
	RunID           string         `json:"runId,omitempty"`
	OrganizationID  string         `json:"organizationId"`
	ActorID         string         `json:"actorId"`
	PolicyVersion   string         `json:"policyVersion"`
	Scope           map[string]any `json:"scope"`
	AgentDefinition string         `json:"agentDefinition"`
	Tool            string         `json:"tool"`
	Arguments       map[string]any `json:"arguments"`
}

type ToolResponse struct {
	ContractVersion string         `json:"contractVersion"`
	RequestID       string         `json:"requestId"`
	Tool            string         `json:"tool"`
	Status          string         `json:"status"`
	Data            map[string]any `json:"data,omitempty"`
	EvidenceRefs    []string       `json:"evidenceRefs,omitempty"`
}

func New(baseURL string, serviceToken ...string) *Client {
	token := ""
	if len(serviceToken) > 0 {
		token = serviceToken[0]
	}
	return &Client{
		baseURL:      strings.TrimRight(baseURL, "/"),
		httpClient:   &http.Client{Timeout: 30 * time.Second},
		serviceToken: token,
	}
}

func NewWithAudience(baseURL, serviceToken, audience string) *Client {
	client := New(baseURL, serviceToken)
	client.audience = strings.TrimSpace(audience)
	return client
}

func (c *Client) Invoke(ctx context.Context, request ToolRequest) (ToolResponse, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return ToolResponse{}, fmt.Errorf("encode gateway request: %w", err)
	}
	if err := contractschemas.ValidateJSON(contractschemas.SchemaToolRequest, body); err != nil {
		return ToolResponse{}, fmt.Errorf("validate gateway request: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/tools/invoke", bytes.NewReader(body))
	if err != nil {
		return ToolResponse{}, fmt.Errorf("create gateway request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("X-Request-ID", request.RequestID)
	if request.TraceID != "" {
		httpRequest.Header.Set("X-Trace-ID", request.TraceID)
	}
	if c.audience != "" {
		tokenSource, err := idtoken.NewTokenSource(ctx, c.audience)
		if err != nil {
			return ToolResponse{}, fmt.Errorf("create Agent Gateway identity token source: %w", err)
		}
		token, err := tokenSource.Token()
		if err != nil {
			return ToolResponse{}, fmt.Errorf("create Agent Gateway identity token: %w", err)
		}
		httpRequest.Header.Set("Authorization", "Bearer "+token.AccessToken)
		if c.serviceToken != "" {
			httpRequest.Header.Set("X-Encois-Service-Token", c.serviceToken)
		}
	} else if c.serviceToken != "" {
		httpRequest.Header.Set("Authorization", "Bearer "+c.serviceToken)
	}
	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return ToolResponse{}, fmt.Errorf("invoke agent gateway: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusBadRequest {
		return ToolResponse{}, fmt.Errorf("agent gateway returned HTTP %d", response.StatusCode)
	}
	var result ToolResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return ToolResponse{}, fmt.Errorf("decode gateway response: %w", err)
	}
	if err := contractschemas.Validate(contractschemas.SchemaToolResult, result); err != nil {
		return ToolResponse{}, fmt.Errorf("validate gateway response: %w", err)
	}
	return result, nil
}
