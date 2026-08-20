package server

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	"github.com/gin-gonic/gin"
)

const genericBlueprintWorkflowType = "encois.user-blueprint.v1"

var workflowCapabilities = []domain.WorkflowCapability{
	{Name: "jira.release_tasks", Kind: "tool", SideEffects: "read-only"},
	{Name: "github.release_activity", Kind: "tool", SideEffects: "read-only"},
	{Name: "email.send", Kind: "tool", SideEffects: "external-write", ApprovalRequired: true},
}

func (s *Server) workflowCapabilities(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"contractVersion":      domain.WorkflowBlueprintContractVersion,
		"temporalWorkflowType": genericBlueprintWorkflowType,
		"capabilities":         workflowCapabilities,
		"execution":            "Agent Gateway validates capabilities; API Gateway starts Temporal",
	})
}

func (s *Server) validateWorkflow(c *gin.Context) {
	var request domain.WorkflowDefinitionRequest
	if !bindJSON(c, &request, domain.WorkflowDefinitionContractVersion) {
		return
	}
	permissions, warnings, err := validateBlueprint(request.Blueprint)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "invalid_workflow_blueprint", err.Error(), false)
		return
	}
	if !s.authorizeWorkflowPermissions(c, request, permissions) {
		return
	}
	c.JSON(http.StatusOK, workflowResponse(request, "validated", permissions, warnings))
}

func (s *Server) createWorkflow(c *gin.Context) {
	var request domain.WorkflowDefinitionRequest
	if !bindJSON(c, &request, domain.WorkflowDefinitionContractVersion) {
		return
	}
	permissions, warnings, err := validateBlueprint(request.Blueprint)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "invalid_workflow_blueprint", err.Error(), false)
		return
	}
	if !s.authorizeWorkflowPermissions(c, request, permissions) {
		return
	}

	workflowID := fmt.Sprintf("blueprint:%s:%s:%s", request.OrganizationID, request.Blueprint.BlueprintID, request.Blueprint.Version)
	response := workflowResponse(request, "draft", permissions, warnings)
	response.WorkflowID = workflowID
	response.TemporalStartRequired = true

	s.workflowMu.Lock()
	s.workflowRecords[workflowID] = response
	s.workflowMu.Unlock()

	c.JSON(http.StatusCreated, response)
}

func (s *Server) getWorkflow(c *gin.Context) {
	workflowID := c.Param("workflowId")
	s.workflowMu.RLock()
	response, ok := s.workflowRecords[workflowID]
	s.workflowMu.RUnlock()
	if !ok {
		errorResponse(c, http.StatusNotFound, "workflow_not_found", "workflow blueprint is not registered in this MVP gateway", false)
		return
	}
	c.JSON(http.StatusOK, response)
}

func (s *Server) authorizeWorkflowPermissions(c *gin.Context, request domain.WorkflowDefinitionRequest, permissions []domain.WorkflowPermissionRequirement) bool {
	for _, permission := range permissions {
		decision := s.policy.Authorize(c.Request.Context(), domain.AuthorizationRequest{
			ExecutionContext: request.ExecutionContext,
			Resource:         permission.Resource,
			Action:           permission.Action,
		})
		if !decision.Allowed {
			errorResponse(c, http.StatusForbidden, "workflow_permission_denied", decision.Reason, false)
			return false
		}
	}
	return true
}

func workflowResponse(request domain.WorkflowDefinitionRequest, status string, permissions []domain.WorkflowPermissionRequirement, warnings []string) domain.WorkflowDefinitionResponse {
	return domain.WorkflowDefinitionResponse{
		ContractVersion:       domain.WorkflowDefinitionContractVersion,
		RequestID:             request.RequestID,
		Status:                status,
		TemporalWorkflowType:  genericBlueprintWorkflowType,
		TemporalStartRequired: false,
		PolicyStatus:          "mvp-allow-all",
		Permissions:           permissions,
		Blueprint:             request.Blueprint,
		Warnings:              warnings,
	}
}

func validateBlueprint(blueprint domain.WorkflowBlueprint) ([]domain.WorkflowPermissionRequirement, []string, error) {
	if blueprint.ContractVersion != domain.WorkflowBlueprintContractVersion {
		return nil, nil, fmt.Errorf("unsupported blueprint contractVersion %q", blueprint.ContractVersion)
	}
	if blueprint.BlueprintID == "" || blueprint.Version == "" || strings.TrimSpace(blueprint.Name) == "" {
		return nil, nil, fmt.Errorf("blueprintId, version, and name are required")
	}
	if blueprint.WorkflowType != genericBlueprintWorkflowType {
		return nil, nil, fmt.Errorf("user blueprints must use workflowType %q", genericBlueprintWorkflowType)
	}
	if len(blueprint.Steps) == 0 {
		return nil, nil, fmt.Errorf("blueprint must contain at least one step")
	}

	steps := make(map[string]domain.WorkflowStep, len(blueprint.Steps))
	for _, step := range blueprint.Steps {
		if step.ID == "" {
			return nil, nil, fmt.Errorf("every step requires an id")
		}
		if _, exists := steps[step.ID]; exists {
			return nil, nil, fmt.Errorf("duplicate step id %q", step.ID)
		}
		if step.Kind != "tool" {
			return nil, nil, fmt.Errorf("step %q has unsupported kind %q; only tool steps are scaffolded", step.ID, step.Kind)
		}
		if step.Tool == "" {
			return nil, nil, fmt.Errorf("tool step %q requires a tool", step.ID)
		}
		if !knownCapability(step.Tool) {
			return nil, nil, fmt.Errorf("tool %q is not in the registered capability catalog", step.Tool)
		}
		steps[step.ID] = step
	}

	permissions := make([]domain.WorkflowPermissionRequirement, 0, len(steps))
	seenPermissions := make(map[string]struct{})
	for _, step := range blueprint.Steps {
		for _, dependency := range step.DependsOn {
			if dependency == step.ID {
				return nil, nil, fmt.Errorf("step %q cannot depend on itself", step.ID)
			}
			if _, exists := steps[dependency]; !exists {
				return nil, nil, fmt.Errorf("step %q depends on unknown step %q", step.ID, dependency)
			}
		}

		permission := capabilityPermission(step.Tool, blueprint.RequiresApproval || step.RequiresApproval)
		key := permission.Resource + ":" + permission.Action
		if _, exists := seenPermissions[key]; !exists {
			permissions = append(permissions, permission)
			seenPermissions[key] = struct{}{}
		}
	}

	if hasDependencyCycle(blueprint.Steps) {
		return nil, nil, fmt.Errorf("blueprint steps contain a dependency cycle")
	}
	warnings := []string{"MVP scaffold stores this blueprint in memory; API Gateway must persist it and start Temporal"}
	for _, permission := range permissions {
		if permission.ApprovalRequired {
			warnings = append(warnings, "one or more steps require explicit approval before execution")
			break
		}
	}
	return permissions, warnings, nil
}

func knownCapability(name string) bool {
	for _, capability := range workflowCapabilities {
		if capability.Name == name {
			return true
		}
	}
	return false
}

func capabilityPermission(tool string, blueprintApproval bool) domain.WorkflowPermissionRequirement {
	permission := domain.WorkflowPermissionRequirement{Resource: tool, Action: "read", ApprovalRequired: blueprintApproval}
	if tool == "email.send" {
		permission.Action = "send"
		permission.ApprovalRequired = true
	}
	return permission
}

func hasDependencyCycle(steps []domain.WorkflowStep) bool {
	indegree := make(map[string]int, len(steps))
	dependents := make(map[string][]string, len(steps))
	for _, step := range steps {
		indegree[step.ID] = len(step.DependsOn)
		for _, dependency := range step.DependsOn {
			dependents[dependency] = append(dependents[dependency], step.ID)
		}
	}
	queue := make([]string, 0, len(steps))
	for id, degree := range indegree {
		if degree == 0 {
			queue = append(queue, id)
		}
	}
	visited := 0
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		visited++
		for _, dependent := range dependents[id] {
			indegree[dependent]--
			if indegree[dependent] == 0 {
				queue = append(queue, dependent)
			}
		}
	}
	return visited != len(steps)
}
