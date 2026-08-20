package gatewayclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

type ToolRequest struct {
	ContractVersion string         `json:"contractVersion"`
	RequestID       string         `json:"requestId"`
	WorkflowID      string         `json:"workflowId"`
	OrganizationID  string         `json:"organizationId"`
	ActorID         string         `json:"actorId"`
	PolicyVersion   string         `json:"policyVersion"`
	AgentDefinition string         `json:"agentDefinition"`
	Tool            string         `json:"tool"`
	Input           map[string]any `json:"input"`
}

type ToolResponse struct {
	ContractVersion string         `json:"contractVersion"`
	RequestID       string         `json:"requestId"`
	Tool            string         `json:"tool"`
	Status          string         `json:"status"`
	Data            map[string]any `json:"data"`
	EvidenceRefs    []string       `json:"evidenceRefs"`
}

func New(baseURL string) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{},
	}
}

func (c *Client) Invoke(ctx context.Context, request ToolRequest) (ToolResponse, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return ToolResponse{}, fmt.Errorf("encode gateway request: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/tools/invoke", bytes.NewReader(body))
	if err != nil {
		return ToolResponse{}, fmt.Errorf("create gateway request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
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
	return result, nil
}
