package server

import (
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
	"github.com/gin-gonic/gin"
)

type Server struct {
	policy          policy.Service
	logger          *slog.Logger
	workflowMu      sync.RWMutex
	workflowRecords map[string]domain.WorkflowDefinitionResponse
}

func SetGinMode(mode string) {
	gin.SetMode(mode)
}

func NewRouter(policyService policy.Service, logger *slog.Logger) *gin.Engine {
	server := &Server{
		policy:          policyService,
		logger:          logger,
		workflowRecords: make(map[string]domain.WorkflowDefinitionResponse),
	}
	router := gin.New()
	router.Use(gin.Recovery(), requestID(), contentTypeJSON())

	router.GET("/health/live", server.live)
	router.GET("/health/ready", server.ready)

	v1 := router.Group("/v1")
	v1.POST("/authorize", server.authorize)
	v1.POST("/permissions/check", server.authorize)
	v1.GET("/tools", server.tools)
	v1.POST("/tools/invoke", server.invokeTool)
	v1.POST("/graph/query", server.graphQuery)
	v1.POST("/artifacts", server.writeArtifact)
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
	c.JSON(http.StatusOK, gin.H{
		"status":  "ready",
		"service": "agent-gateway",
		"dependencies": gin.H{
			"policy":       "mvp-allow-all",
			"providers":    "mock-in-memory",
			"cloudStorage": "not-configured",
			"spanner":      "not-configured",
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
	c.JSON(http.StatusOK, gin.H{
		"tools": []gin.H{
			{"name": "jira.release_tasks", "mode": "mock", "sideEffects": "read-only"},
			{"name": "github.release_activity", "mode": "mock", "sideEffects": "read-only"},
		},
	})
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

	decision := s.policy.Authorize(c.Request.Context(), domain.AuthorizationRequest{
		ExecutionContext: request.ExecutionContext,
		Resource:         request.Tool,
		Action:           "invoke_tool",
	})
	if !decision.Allowed {
		errorResponse(c, http.StatusForbidden, "policy_denied", decision.Reason, false)
		return
	}

	data, evidenceRefs, ok := mockTool(request.Tool)
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
	errorResponse(c, http.StatusNotImplemented, "spanner_not_configured", "Spanner Graph adapter is intentionally deferred", false)
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
	decision := s.policy.Authorize(c.Request.Context(), domain.AuthorizationRequest{
		ExecutionContext: request.ExecutionContext,
		Resource:         "cloud-storage",
		Action:           "write_artifact",
	})
	if !decision.Allowed {
		errorResponse(c, http.StatusForbidden, "policy_denied", decision.Reason, false)
		return
	}
	errorResponse(c, http.StatusNotImplemented, "storage_not_configured", "Cloud Storage adapter is intentionally deferred", false)
}

func mockTool(toolName string) (map[string]any, []string, bool) {
	switch toolName {
	case "jira.release_tasks":
		return map[string]any{
			"source":         "jira",
			"releaseId":      "mock-release-aug-30",
			"totalTasks":     10,
			"completedTasks": 8,
			"remainingTasks": 2,
			"blockedTasks":   1,
			"observedAt":     time.Now().UTC().Format(time.RFC3339),
		}, []string{"mock:jira:release-aug-30"}, true
	case "github.release_activity":
		return map[string]any{
			"source":             "github",
			"releaseId":          "mock-release-aug-30",
			"openPullRequests":   2,
			"failingChecks":      1,
			"commitsSinceCutoff": 12,
			"observedAt":         time.Now().UTC().Format(time.RFC3339),
		}, []string{"mock:github:release-aug-30"}, true
	default:
		return nil, nil, false
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
	case *domain.GraphQueryRequest:
		validationError = request.ExecutionContext.Validate(expectedContract)
	case *domain.ArtifactWriteRequest:
		validationError = request.ExecutionContext.Validate(expectedContract)
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

func contentTypeJSON() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Content-Type", "application/json")
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
