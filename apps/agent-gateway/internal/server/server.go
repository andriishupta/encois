package server

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	"github.com/andriishupta/encois/apps/agent-gateway/internal/policy"
	contractschemas "github.com/andriishupta/encois/packages/contracts"
	"github.com/gin-gonic/gin"
)

type Server struct {
	policy                policy.Service
	logger                *slog.Logger
	serviceAuthConfigured bool
	workflowMu            sync.RWMutex
	workflowRecords       map[string]domain.WorkflowDefinitionResponse
	artifactStore         ArtifactStore
	graphStore            GraphStore
}

// RouterOptions contains replaceable data-plane adapters. The default router
// uses deterministic local implementations; hosted wiring selects Cloud
// Storage and Spanner without changing routes, authentication, or policy code.
type RouterOptions struct {
	ArtifactStore ArtifactStore
	GraphStore    GraphStore
}

func SetGinMode(mode string) {
	gin.SetMode(mode)
}

func NewRouter(policyService policy.Service, logger *slog.Logger, serviceToken string) *gin.Engine {
	return NewRouterWithOptions(policyService, logger, serviceToken, RouterOptions{})
}

func NewRouterWithOptions(policyService policy.Service, logger *slog.Logger, serviceToken string, options RouterOptions) *gin.Engine {
	artifactStore := options.ArtifactStore
	if artifactStore == nil {
		artifactStore = newMemoryArtifactStore()
	}
	graphStore := options.GraphStore
	if graphStore == nil {
		graphStore = newMemoryGraphStore()
	}
	server := &Server{
		policy:                policyService,
		logger:                logger,
		serviceAuthConfigured: serviceToken != "",
		workflowRecords:       make(map[string]domain.WorkflowDefinitionResponse),
		artifactStore:         artifactStore,
		graphStore:            graphStore,
	}
	router := gin.New()
	router.Use(gin.Recovery(), requestID(), traceID(), requestLogging(logger), contentTypeJSON())

	router.GET("/health/live", server.live)
	router.GET("/health/ready", server.ready)

	v1 := router.Group("/v1")
	v1.Use(serviceAuthentication(serviceToken))
	v1.POST("/authorize", server.authorize)
	v1.POST("/permissions/check", server.authorize)
	v1.GET("/tools", server.tools)
	v1.POST("/tools/invoke", server.invokeTool)
	v1.POST("/graph/query", server.graphQuery)
	v1.POST("/graph/upsert", server.upsertGraph)
	v1.POST("/artifacts", server.writeArtifact)
	v1.POST("/artifacts/read", server.readArtifact)
	v1.GET("/workflow-capabilities", server.workflowCapabilities)
	v1.POST("/workflows/validate", server.validateWorkflow)
	v1.POST("/workflows", server.createWorkflow)
	v1.GET("/workflows/:workflowId", server.getWorkflow)

	return router
}

func (s *Server) live(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "agent-gateway"})
}

func (s *Server) ready(c *gin.Context) {
	status := http.StatusOK
	state := "ready"
	if !s.serviceAuthConfigured {
		status = http.StatusServiceUnavailable
		state = "service_auth_not_configured"
	}
	c.JSON(status, gin.H{
		"status":  state,
		"service": "agent-gateway",
		"dependencies": gin.H{
			"policy":       "read-only-fixture-policy",
			"serviceAuth":  s.serviceAuthConfigured,
			"providers":    "mock-in-memory",
			"cloudStorage": s.artifactStoreStatus(),
			"spanner":      s.graphStoreStatus(),
		},
	})
}

func (s *Server) authorize(c *gin.Context) {
	var request domain.AuthorizationRequest
	if !bindJSON(c, &request, domain.AuthorizationContractVersion) {
		return
	}
	if request.Resource == "" || request.Action == "" {
		errorResponse(c, http.StatusBadRequest, "invalid_request", "resource and action are required", false)
		return
	}
	c.JSON(http.StatusOK, s.policy.Authorize(c.Request.Context(), request))
}

func (s *Server) tools(c *gin.Context) {
	tools := make([]domain.WorkflowCapability, 0, len(workflowCapabilities))
	for _, capability := range workflowCapabilities {
		if capability.Kind == "tool" {
			if err := contractschemas.Validate(contractschemas.SchemaToolManifest, capability); err != nil {
				errorResponse(c, http.StatusInternalServerError, "invalid_tool_manifest", err.Error(), false)
				return
			}
			tools = append(tools, capability)
		}
	}
	c.JSON(http.StatusOK, gin.H{"tools": tools})
}

func (s *Server) invokeTool(c *gin.Context) {
	var request domain.ToolInvocationRequest
	if bindJSON(c, &request, domain.ToolRequestContractVersion) == false {
		return
	}
	if request.Tool == "" {
		errorResponse(c, http.StatusBadRequest, "invalid_request", "tool is required", false)
		return
	}
	if request.Arguments == nil {
		errorResponse(c, http.StatusBadRequest, "invalid_request", "arguments are required", false)
		return
	}
	decision := s.policy.Authorize(c.Request.Context(), domain.AuthorizationRequest{
		ExecutionContext: request.ExecutionContext,
		Resource:         request.Tool,
		Action:           "invoke_tool",
	})
	if !decision.Allowed {
		errorResponse(c, http.StatusForbidden, "policy_denied", decision.Reason, false)
		return
	}
	capability, registered := capabilityByName(request.Tool)
	if !registered {
		errorResponse(c, http.StatusNotImplemented, "tool_not_implemented", "tool is not registered", false)
		return
	}
	if err := contractschemas.Validate(contractschemas.SchemaToolManifest, capability); err != nil {
		errorResponse(c, http.StatusInternalServerError, "invalid_tool_manifest", err.Error(), false)
		return
	}
	if !scopeSatisfies(request.Scope, capability.RequiredScope) {
		errorResponse(c, http.StatusForbidden, "scope_denied", "tool requires a broader execution scope", false)
		return
	}

	data, evidenceRefs, freshness, ok := mockTool(request.Tool)
	if !ok {
		errorResponse(c, http.StatusNotImplemented, "tool_not_implemented", "provider adapter is not configured", false)
		return
	}
	c.JSON(http.StatusOK, domain.ToolInvocationResponse{
		ContractVersion: domain.ToolResultContractVersion,
		RequestID:       request.RequestID,
		Tool:            request.Tool,
		Status:          "mocked",
		Data:            data,
		EvidenceRefs:    evidenceRefs,
		Freshness:       freshness,
	})
}

func (s *Server) graphQuery(c *gin.Context) {
	var request domain.GraphQueryRequest
	if !bindJSON(c, &request, domain.GraphQueryContractVersion) {
		return
	}
	if strings.TrimSpace(request.Query) == "" {
		errorResponse(c, http.StatusBadRequest, "invalid_request", "query is required", false)
		return
	}
	decision := s.policy.Authorize(c.Request.Context(), domain.AuthorizationRequest{
		ExecutionContext: request.ExecutionContext,
		Resource:         "spanner.graph",
		Action:           "read",
	})
	if !decision.Allowed {
		errorResponse(c, http.StatusForbidden, "policy_denied", decision.Reason, false)
		return
	}
	result, err := s.graphStore.Query(c.Request.Context(), request)
	if err != nil {
		errorResponse(c, http.StatusBadGateway, "graph_query_failed", err.Error(), true)
		return
	}
	if err := contractschemas.Validate(contractschemas.SchemaGraphQueryResult, result); err != nil {
		errorResponse(c, http.StatusInternalServerError, "invalid_graph_result", err.Error(), false)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (s *Server) upsertGraph(c *gin.Context) {
	var request domain.GraphMutation
	if !bindJSON(c, &request, domain.GraphUpsertContractVersion) {
		return
	}
	if request.OrganizationID == "" || request.WorkflowID == "" || request.ActorID == "" || request.PolicyVersion == "" || request.Scope.Empty() {
		errorResponse(c, http.StatusBadRequest, "invalid_request", "workflow execution context is required for graph projection", false)
		return
	}
	decision := s.policy.Authorize(c.Request.Context(), domain.AuthorizationRequest{ExecutionContext: request.ExecutionContext, Resource: "spanner.graph", Action: "write_facts"})
	if !decision.Allowed {
		errorResponse(c, http.StatusForbidden, "policy_denied", decision.Reason, false)
		return
	}
	if err := s.graphStore.Upsert(c.Request.Context(), request); err != nil {
		errorResponse(c, http.StatusBadGateway, "graph_upsert_failed", err.Error(), true)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "completed", "requestId": request.RequestID})
}

func (s *Server) writeArtifact(c *gin.Context) {
	var request domain.ArtifactWriteRequest
	if bindJSON(c, &request, domain.ArtifactWriteContractVersion) == false {
		return
	}
	if request.ObjectKey == "" || request.DataRef == "" {
		errorResponse(c, http.StatusBadRequest, "invalid_request", "objectKey and dataRef are required", false)
		return
	}
	if request.WorkflowID == "" || request.ActorID == "" || request.PolicyVersion == "" || request.Scope.Empty() {
		errorResponse(c, http.StatusBadRequest, "invalid_request", "workflow execution context is required for artifact storage", false)
		return
	}
	decision := s.policy.Authorize(c.Request.Context(), domain.AuthorizationRequest{
		ExecutionContext: request.ExecutionContext,
		Resource:         "cloud-storage",
		Action:           "write_artifact",
	})
	if !decision.Allowed {
		errorResponse(c, http.StatusForbidden, "policy_denied", decision.Reason, false)
		return
	}
	result, err := s.artifactStore.Write(c.Request.Context(), request)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "invalid_artifact_request", err.Error(), false)
		return
	}
	if err := contractschemas.Validate(contractschemas.SchemaArtifactWriteResult, result); err != nil {
		errorResponse(c, http.StatusInternalServerError, "invalid_artifact_result", err.Error(), false)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (s *Server) readArtifact(c *gin.Context) {
	var request domain.ArtifactReadRequest
	if !bindJSON(c, &request, domain.ArtifactReadContractVersion) {
		return
	}
	if request.ArtifactRef == "" || request.OrganizationID == "" || request.WorkflowID == "" || request.ActorID == "" || request.PolicyVersion == "" || request.Scope.Empty() {
		errorResponse(c, http.StatusBadRequest, "invalid_request", "artifact reference and workflow execution context are required", false)
		return
	}
	decision := s.policy.Authorize(c.Request.Context(), domain.AuthorizationRequest{ExecutionContext: request.ExecutionContext, Resource: "cloud-storage", Action: "read_artifact"})
	if !decision.Allowed {
		errorResponse(c, http.StatusForbidden, "policy_denied", decision.Reason, false)
		return
	}
	result, err := s.artifactStore.Read(c.Request.Context(), request)
	if err != nil {
		errorResponse(c, http.StatusBadGateway, "artifact_read_failed", err.Error(), true)
		return
	}
	c.Header("X-Artifact-Ref", result.ArtifactRef)
	c.Data(http.StatusOK, result.ContentType, result.Bytes)
}

func (s *Server) artifactStoreStatus() string {
	if _, ok := s.artifactStore.(*gcsArtifactStore); ok {
		return "gcp-cloud-storage"
	}
	return "mock-in-memory"
}

func (s *Server) graphStoreStatus() string {
	if _, ok := s.graphStore.(*spannerGraphStore); ok {
		return "gcp-spanner"
	}
	return "mock-in-memory"
}

func mockTool(toolName string) (map[string]any, []string, []contractschemas.SourceFreshness, bool) {
	now := time.Now().UTC().Format(time.RFC3339)
	switch toolName {
	case "jira.project_tasks":
		return map[string]any{
			"source":         "jira",
			"projectId":      "mock-project-checkout",
			"totalTasks":     10,
			"completedTasks": 8,
			"remainingTasks": 2,
			"blockedTasks":   1,
			"observedAt":     time.Now().UTC().Format(time.RFC3339),
		}, []string{"mock:jira:project-checkout"}, []contractschemas.SourceFreshness{{Source: "jira", ObservedAt: now, IngestedAt: now, Status: contractschemas.FreshnessFresh}}, true
	case "github.project_activity":
		return map[string]any{
			"source":             "github",
			"projectId":          "mock-project-checkout",
			"openPullRequests":   2,
			"failingChecks":      1,
			"commitsSinceCutoff": 12,
			"observedAt":         time.Now().UTC().Format(time.RFC3339),
		}, []string{"mock:github:project-checkout"}, []contractschemas.SourceFreshness{{Source: "github", ObservedAt: now, IngestedAt: now, Status: contractschemas.FreshnessFresh}}, true
	default:
		return nil, nil, nil, false
	}
}

func bindJSON(c *gin.Context, target any, expectedContract string) bool {
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		errorResponse(c, http.StatusBadRequest, "invalid_json", err.Error(), false)
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			errorResponse(c, http.StatusBadRequest, "invalid_json", "request body must contain one JSON object", false)
		} else {
			errorResponse(c, http.StatusBadRequest, "invalid_json", err.Error(), false)
		}
		return false
	}
	var validationError error
	switch request := target.(type) {
	case *domain.AuthorizationRequest:
		validationError = request.ExecutionContext.Validate(expectedContract)
	case *domain.ToolInvocationRequest:
		validationError = request.ExecutionContext.Validate(expectedContract)
		if validationError == nil {
			validationError = contractschemas.Validate(contractschemas.SchemaToolRequest, request)
		}
	case *domain.GraphQueryRequest:
		validationError = request.ExecutionContext.Validate(expectedContract)
		if validationError == nil {
			validationError = contractschemas.Validate(contractschemas.SchemaGraphQuery, request)
		}
	case *domain.GraphMutation:
		validationError = request.ExecutionContext.Validate(expectedContract)
		if validationError == nil {
			validationError = contractschemas.Validate(contractschemas.SchemaGraphUpsert, request)
		}
	case *domain.ArtifactWriteRequest:
		validationError = request.ExecutionContext.Validate(expectedContract)
		if validationError == nil {
			validationError = contractschemas.Validate(contractschemas.SchemaArtifactWrite, request)
		}
	case *domain.ArtifactReadRequest:
		validationError = request.ExecutionContext.Validate(expectedContract)
		if validationError == nil {
			validationError = contractschemas.Validate(contractschemas.SchemaArtifactRead, request)
		}
	}
	if validationError != nil {
		errorResponse(c, http.StatusBadRequest, "invalid_contract", validationError.Error(), false)
		return false
	}
	return true
}

func requestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = fmt.Sprintf("gateway-%d", time.Now().UnixNano())
		}
		c.Set("requestID", requestID)
		c.Header("X-Request-ID", requestID)
		c.Next()
	}
}

func traceID() gin.HandlerFunc {
	return func(c *gin.Context) {
		value := c.GetHeader("X-Trace-ID")
		if value == "" {
			value = c.GetString("requestID")
		}
		c.Set("traceID", value)
		c.Header("X-Trace-ID", value)
		c.Next()
	}
}

func requestLogging(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		startedAt := time.Now()
		c.Next()
		logger.Info("http.request.completed",
			"durationMs", time.Since(startedAt).Milliseconds(),
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"requestId", c.GetString("requestID"),
			"traceId", c.GetString("traceID"),
			"status", c.Writer.Status(),
		)
	}
}

func contentTypeJSON() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Content-Type", "application/json")
		c.Next()
	}
}

func serviceAuthentication(expectedToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if expectedToken == "" {
			errorResponse(c, http.StatusServiceUnavailable, "service_auth_not_configured", "Agent Gateway service authentication is not configured", false)
			return
		}
		value := c.GetHeader("X-Encois-Service-Token")
		if value != "" {
			if subtle.ConstantTimeCompare([]byte(value), []byte(expectedToken)) != 1 {
				errorResponse(c, http.StatusUnauthorized, "service_unauthenticated", "Agent Runtime service authentication is required", false)
				return
			}
			c.Next()
			return
		}
		value = c.GetHeader("Authorization")
		const prefix = "Bearer "
		if !strings.HasPrefix(value, prefix) || subtle.ConstantTimeCompare([]byte(strings.TrimPrefix(value, prefix)), []byte(expectedToken)) != 1 {
			errorResponse(c, http.StatusUnauthorized, "service_unauthenticated", "Agent Runtime service authentication is required", false)
			return
		}
		c.Next()
	}
}

func errorResponse(c *gin.Context, status int, code, message string, retryable bool) {
	c.AbortWithStatusJSON(status, gin.H{
		"error": gin.H{
			"code":      code,
			"message":   message,
			"requestId": c.GetString("requestID"),
			"retryable": retryable,
		},
	})
}
