package server

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	"github.com/andriishupta/encois/apps/agent-gateway/internal/observability"
	"github.com/andriishupta/encois/apps/agent-gateway/internal/policy"
	contractschemas "github.com/andriishupta/encois/packages/contracts"
	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
)

type Server struct {
	policy                policy.Service
	logger                *slog.Logger
	serviceAuthConfigured bool
	capabilitySecret      string
	requireCapability     bool
	workflowMu            sync.RWMutex
	workflowRecords       map[string]domain.WorkflowDefinitionResponse
	artifactStore         ArtifactStore
	graphStore            GraphStore
	providerTools         ProviderToolRegistry
}

// RouterOptions contains replaceable data-plane adapters. The default router
// must receive explicit data-plane adapters; hosted wiring selects Cloud
// Storage and Spanner without changing routes, authentication, or policy code.
type RouterOptions struct {
	ArtifactStore     ArtifactStore
	GraphStore        GraphStore
	ProviderTools     ProviderToolRegistry
	CapabilitySecret  string
	RequireCapability bool
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
		artifactStore = unconfiguredArtifactStore{}
	}
	graphStore := options.GraphStore
	if graphStore == nil {
		graphStore = unconfiguredGraphStore{}
	}
	providerTools := options.ProviderTools
	if providerTools == nil {
		providerTools = unconfiguredProviderToolRegistry{}
	}
	server := &Server{
		policy:                policyService,
		logger:                logger,
		serviceAuthConfigured: serviceToken != "",
		capabilitySecret:      options.CapabilitySecret,
		requireCapability:     options.RequireCapability,
		workflowRecords:       make(map[string]domain.WorkflowDefinitionResponse),
		artifactStore:         artifactStore,
		graphStore:            graphStore,
		providerTools:         providerTools,
	}
	router := gin.New()
	router.Use(gin.Recovery(), requestID(), traceID(), otelTracing(), requestLogging(logger), contentTypeJSON())

	router.GET("/health/live", server.live)
	router.GET("/health/ready", server.ready)

	v1 := router.Group("/v1")
	v1.Use(serviceAuthentication(serviceToken))
	v1.POST("/authorize", server.authorize)
	v1.POST("/permissions/check", server.authorize)
	v1.GET("/tools", server.tools)
	v1.POST("/tools/invoke", server.invokeTool)
	v1.POST("/provider-health/check", server.providerHealthCheck)
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
	if s.requireCapability && s.capabilitySecret == "" {
		status = http.StatusServiceUnavailable
		state = "execution_capability_not_configured"
	}
	if err := s.providerTools.Ready(); err != nil {
		status = http.StatusServiceUnavailable
		state = "provider_tools_not_ready"
	}
	if s.artifactStoreStatus() == "unconfigured" || s.graphStoreStatus() == "unconfigured" {
		status = http.StatusServiceUnavailable
		state = "data_plane_not_configured"
	}
	c.JSON(status, gin.H{
		"status":  state,
		"service": "agent-gateway",
		"dependencies": gin.H{
			"policy":       "read-only-fixture-policy",
			"serviceAuth":  s.serviceAuthConfigured,
			"providers":    s.providerTools.Status(),
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

func (s *Server) authorizeExecution(c *gin.Context, execution domain.ExecutionContext) bool {
	if !s.requireCapability && s.capabilitySecret == "" {
		return true
	}
	if s.capabilitySecret == "" {
		errorResponse(c, http.StatusServiceUnavailable, "capability_not_configured", "Agent Gateway execution capability is not configured", false)
		return false
	}
	if err := verifyExecutionCapability(execution.Capability, s.capabilitySecret, execution, time.Now()); err != nil {
		errorResponse(c, http.StatusForbidden, "capability_denied", "The execution capability is not valid for this request", false)
		return false
	}
	return true
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
	if request.BlueprintID == "" || request.BlueprintVersion == "" || len(request.AllowedTools) == 0 {
		errorResponse(c, http.StatusForbidden, "blueprint_manifest_required", "tool execution requires an immutable Blueprint manifest", false)
		return
	}
	if !containsString(request.AllowedTools, request.Tool) {
		errorResponse(c, http.StatusForbidden, "tool_not_allowed", "tool is not allowed by the immutable Blueprint manifest", false)
		return
	}
	if !s.authorizeExecution(c, request.ExecutionContext) {
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

	result, err := s.providerTools.Invoke(c.Request.Context(), request)
	if err != nil {
		status := http.StatusBadGateway
		code := "provider_tool_failed"
		retryable := true
		if errors.Is(err, ErrProviderReauthorization) {
			status = http.StatusFailedDependency
			code = "provider_reauthorization_required"
			retryable = false
		} else if errors.Is(err, ErrProviderCredential) {
			status = http.StatusServiceUnavailable
			code = "provider_credential_unavailable"
			retryable = false
		} else if errors.Is(err, ErrProviderToolUnavailable) {
			status = http.StatusNotImplemented
			code = "tool_not_implemented"
			retryable = false
		}
		errorResponse(c, status, code, safeProviderToolError(err), retryable)
		return
	}
	c.JSON(http.StatusOK, domain.ToolInvocationResponse{
		ContractVersion: domain.ToolResultContractVersion,
		RequestID:       request.RequestID,
		Tool:            request.Tool,
		Status:          "completed",
		Data:            result.Data,
		EvidenceRefs:    result.EvidenceRefs,
		Provenance:      result.Provenance,
		Confidence:      result.Confidence,
		Freshness:       result.Freshness,
	})
}

func (s *Server) providerHealthCheck(c *gin.Context) {
	var request struct {
		IntegrationID string `json:"integrationId"`
		Provider      string `json:"provider"`
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		errorResponse(c, http.StatusBadRequest, "invalid_json", err.Error(), false)
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		errorResponse(c, http.StatusBadRequest, "invalid_json", "request body must contain one JSON object", false)
		return
	}
	organizationID := strings.TrimSpace(c.GetHeader("X-Organization-ID"))
	if organizationID == "" || strings.TrimSpace(request.IntegrationID) == "" || strings.TrimSpace(request.Provider) == "" {
		errorResponse(c, http.StatusBadRequest, "invalid_request", "X-Organization-ID, integrationId, and provider are required", false)
		return
	}
	if err := s.providerTools.Check(c.Request.Context(), ProviderHealthCheckRequest{
		OrganizationID: organizationID,
		IntegrationID:  strings.TrimSpace(request.IntegrationID),
		Provider:       strings.TrimSpace(request.Provider),
	}); err != nil {
		status := http.StatusBadGateway
		code := "provider_health_check_failed"
		retryable := true
		if errors.Is(err, ErrProviderReauthorization) {
			status = http.StatusFailedDependency
			code = "provider_reauthorization_required"
			retryable = false
		} else if errors.Is(err, ErrProviderCredential) {
			status = http.StatusServiceUnavailable
			code = "provider_credential_unavailable"
			retryable = false
		} else if errors.Is(err, ErrProviderToolUnavailable) {
			status = http.StatusNotImplemented
			code = "provider_health_check_unavailable"
			retryable = false
		}
		errorResponse(c, status, code, safeProviderToolError(err), retryable)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"integrationId": strings.TrimSpace(request.IntegrationID),
		"provider":      strings.TrimSpace(request.Provider),
		"status":        "active",
	}})
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func safeProviderToolError(err error) string {
	if errors.Is(err, ErrProviderReauthorization) {
		return "The provider rejected the credential and requires authorization again."
	}
	if errors.Is(err, ErrProviderCredential) {
		return "The scoped provider credential is unavailable or invalid."
	}
	if errors.Is(err, ErrProviderToolUnavailable) {
		return "The provider tool is not configured for this deployment."
	}
	return "The provider tool request failed."
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
	if !s.authorizeExecution(c, request.ExecutionContext) {
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
	if !s.authorizeExecution(c, request.ExecutionContext) {
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
	if !s.authorizeExecution(c, request.ExecutionContext) {
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
	if !s.authorizeExecution(c, request.ExecutionContext) {
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
	if _, ok := s.artifactStore.(unconfiguredArtifactStore); ok {
		return "unconfigured"
	}
	return "mock-in-memory"
}

func (s *Server) graphStoreStatus() string {
	if _, ok := s.graphStore.(*spannerGraphStore); ok {
		return "gcp-spanner"
	}
	if _, ok := s.graphStore.(unconfiguredGraphStore); ok {
		return "unconfigured"
	}
	return "mock-in-memory"
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

func otelTracing() gin.HandlerFunc {
	return func(c *gin.Context) {
		parent := otel.GetTextMapPropagator().Extract(c.Request.Context(), propagation.HeaderCarrier(c.Request.Header))
		ctx, span := observability.StartSpan(parent, c.Request.Method+" "+c.Request.URL.Path)
		c.Request = c.Request.WithContext(ctx)
		c.Next()
		span.SetAttributes(attribute.Int("http.status_code", c.Writer.Status()))
		span.End()
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
