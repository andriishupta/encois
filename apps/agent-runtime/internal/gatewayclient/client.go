package gatewayclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	Capability      string         `json:"capability"`
	AgentDefinition string         `json:"agentDefinition"`
	Tool            string         `json:"tool"`
	Arguments       map[string]any `json:"arguments"`
}

type ToolResponse struct {
	ContractVersion string                            `json:"contractVersion"`
	RequestID       string                            `json:"requestId"`
	Tool            string                            `json:"tool"`
	Status          string                            `json:"status"`
	Data            map[string]any                    `json:"data,omitempty"`
	EvidenceRefs    []string                          `json:"evidenceRefs,omitempty"`
	Freshness       []contractschemas.SourceFreshness `json:"freshness,omitempty"`
}

type ArtifactReadRequest struct {
	ContractVersion string         `json:"contractVersion"`
	RequestID       string         `json:"requestId"`
	TraceID         string         `json:"traceId,omitempty"`
	WorkflowID      string         `json:"workflowId"`
	RunID           string         `json:"runId,omitempty"`
	OrganizationID  string         `json:"organizationId"`
	ActorID         string         `json:"actorId"`
	PolicyVersion   string         `json:"policyVersion"`
	Scope           map[string]any `json:"scope"`
	Capability      string         `json:"capability"`
	ArtifactRef     string         `json:"artifactRef"`
}

type ArtifactReadResponse struct {
	ArtifactRef string
	ContentType string
	Bytes       []byte
}

type GraphMutation struct {
	ContractVersion string         `json:"contractVersion"`
	RequestID       string         `json:"requestId"`
	TraceID         string         `json:"traceId,omitempty"`
	WorkflowID      string         `json:"workflowId"`
	RunID           string         `json:"runId,omitempty"`
	OrganizationID  string         `json:"organizationId"`
	ActorID         string         `json:"actorId"`
	PolicyVersion   string         `json:"policyVersion"`
	Scope           map[string]any `json:"scope"`
	Capability      string         `json:"capability"`
	Nodes           []GraphNode    `json:"nodes"`
	Edges           []GraphEdge    `json:"edges"`
}

type GraphNode struct {
	ID         string         `json:"id"`
	Type       string         `json:"type"`
	Properties map[string]any `json:"properties"`
	Provenance map[string]any `json:"provenance,omitempty"`
}

type GraphEdge struct {
	ID           string         `json:"id"`
	SourceID     string         `json:"sourceId"`
	TargetID     string         `json:"targetId"`
	Relationship string         `json:"relationship"`
	Properties   map[string]any `json:"properties"`
	Provenance   map[string]any `json:"provenance,omitempty"`
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

func (c *Client) ReadArtifact(ctx context.Context, request ArtifactReadRequest) (ArtifactReadResponse, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return ArtifactReadResponse{}, fmt.Errorf("encode artifact read request: %w", err)
	}
	if err := contractschemas.ValidateJSON(contractschemas.SchemaArtifactRead, body); err != nil {
		return ArtifactReadResponse{}, fmt.Errorf("validate artifact read request: %w", err)
	}
	httpRequest, err := c.newRequest(ctx, http.MethodPost, "/v1/artifacts/read", body, request.RequestID, request.TraceID)
	if err != nil {
		return ArtifactReadResponse{}, err
	}
	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return ArtifactReadResponse{}, fmt.Errorf("read agent gateway artifact: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		return ArtifactReadResponse{}, fmt.Errorf("agent gateway artifact read returned HTTP %d", response.StatusCode)
	}
	contentType := response.Header.Get("Content-Type")
	data, err := io.ReadAll(io.LimitReader(response.Body, 20<<20))
	if err != nil {
		return ArtifactReadResponse{}, fmt.Errorf("read artifact response: %w", err)
	}
	return ArtifactReadResponse{ArtifactRef: request.ArtifactRef, ContentType: contentType, Bytes: data}, nil
}

func (c *Client) UpsertGraph(ctx context.Context, request GraphMutation) error {
	body, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("encode graph mutation: %w", err)
	}
	if err := contractschemas.ValidateJSON(contractschemas.SchemaGraphUpsert, body); err != nil {
		return fmt.Errorf("validate graph mutation: %w", err)
	}
	httpRequest, err := c.newRequest(ctx, http.MethodPost, "/v1/graph/upsert", body, request.RequestID, request.TraceID)
	if err != nil {
		return err
	}
	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return fmt.Errorf("upsert Agent Gateway graph facts: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("agent gateway graph upsert returned HTTP %d", response.StatusCode)
	}
	return nil
}

func (c *Client) newRequest(ctx context.Context, method, path string, body []byte, requestID, traceID string) (*http.Request, error) {
	httpRequest, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create gateway request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("X-Request-ID", requestID)
	if traceID != "" {
		httpRequest.Header.Set("X-Trace-ID", traceID)
	}
	if c.audience != "" {
		tokenSource, err := idtoken.NewTokenSource(ctx, c.audience)
		if err != nil {
			return nil, fmt.Errorf("create Agent Gateway identity token source: %w", err)
		}
		token, err := tokenSource.Token()
		if err != nil {
			return nil, fmt.Errorf("create Agent Gateway identity token: %w", err)
		}
		httpRequest.Header.Set("Authorization", "Bearer "+token.AccessToken)
		if c.serviceToken != "" {
			httpRequest.Header.Set("X-Encois-Service-Token", c.serviceToken)
		}
	} else if c.serviceToken != "" {
		httpRequest.Header.Set("Authorization", "Bearer "+c.serviceToken)
	}
	return httpRequest, nil
}
