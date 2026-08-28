package server

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	contracts "github.com/andriishupta/encois/packages/contracts"
	"github.com/gin-gonic/gin"
)

var workflowCapabilities = []domain.WorkflowCapability{
	{
		ContractVersion: domain.ToolManifestContractVersion,
		Name:            "jira.project_tasks",
		Version:         "1.0.0",
		Kind:            "tool",
		Description:     "Read project task status from Jira.",
		SideEffects:     "read-only",
		InputSchema:     projectToolInputSchema(),
		OutputSchema:    jiraProjectOutputSchema(),
		Annotations:     domain.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
		RequiredScope:   []string{"ids"},
		Available:       true,
	},
	{
		ContractVersion: domain.ToolManifestContractVersion,
		Name:            "github.project_activity",
		Version:         "1.0.0",
		Kind:            "tool",
		Description:     "Read pull requests, checks, and commits related to a project.",
		SideEffects:     "read-only",
		InputSchema:     projectToolInputSchema(),
		OutputSchema:    githubProjectOutputSchema(),
		Annotations:     domain.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
		RequiredScope:   []string{"ids"},
		Available:       true,
	},
	{
		ContractVersion: domain.ToolManifestContractVersion,
		Name:            "github.repository_activity",
		Version:         "1.0.0",
		Kind:            "tool",
		Description:     "Read pull requests, checks, and commits for a GitHub repository.",
		SideEffects:     "read-only",
		InputSchema:     projectToolInputSchema(),
		OutputSchema:    githubProjectOutputSchema(),
		Annotations:     domain.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
		RequiredScope:   []string{"ids"},
		Available:       true,
	},
	{
		ContractVersion:  domain.ToolManifestContractVersion,
		Name:             "email.send",
		Version:          "1.0.0",
		Kind:             "tool",
		Description:      "Send an external email after explicit approval.",
		SideEffects:      "external-write",
		InputSchema:      map[string]any{"type": "object", "additionalProperties": true},
		OutputSchema:     map[string]any{"type": "object"},
		Annotations:      domain.ToolAnnotations{DestructiveHint: true, OpenWorldHint: true},
		RequiredScope:    []string{"ids"},
		Available:        false,
		ApprovalRequired: true,
	},
}

func (s *Server) workflowCapabilities(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"contractVersion":      domain.WorkflowBlueprintContractVersion,
		"temporalWorkflowType": string(contracts.WorkflowTypeDynamic),
		"capabilities":         workflowCapabilities,
		"execution":            "Agent Gateway validates capabilities; API Gateway starts Temporal",
	})
}

func projectToolInputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"input":         map[string]any{"type": "object"},
			"businessInput": map[string]any{"type": "object"},
			"priorResults":  map[string]any{"type": "object"},
		},
		"additionalProperties": true,
	}
}

func jiraProjectOutputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"source":         map[string]any{"const": "jira"},
			"projectId":      map[string]any{"type": "string"},
			"totalTasks":     map[string]any{"type": "integer"},
			"completedTasks": map[string]any{"type": "integer"},
			"remainingTasks": map[string]any{"type": "integer"},
			"blockedTasks":   map[string]any{"type": "integer"},
			"observedAt":     map[string]any{"type": "string"},
		},
		"required":             []string{"source", "projectId", "observedAt"},
		"additionalProperties": true,
	}
}

func githubProjectOutputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"source":             map[string]any{"const": "github"},
			"projectId":          map[string]any{"type": "string"},
			"openPullRequests":   map[string]any{"type": "integer"},
			"failingChecks":      map[string]any{"type": "integer"},
			"commitsSinceCutoff": map[string]any{"type": "integer"},
			"observedAt":         map[string]any{"type": "string"},
		},
		"required":             []string{"source", "projectId", "observedAt"},
		"additionalProperties": true,
	}
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
	organizationID := strings.TrimSpace(c.GetHeader("X-Organization-ID"))
	if organizationID == "" {
		errorResponse(c, http.StatusBadRequest, "organization_required", "X-Organization-ID is required", false)
		return
	}
	if !blueprintIDBelongsToOrganization(workflowID, organizationID) {
		errorResponse(c, http.StatusForbidden, "organization_scope_denied", "workflow is outside the organization scope", false)
		return
	}
	s.workflowMu.RLock()
	response, ok := s.workflowRecords[workflowID]
	s.workflowMu.RUnlock()
	if !ok {
		errorResponse(c, http.StatusNotFound, "workflow_not_found", "workflow blueprint is not registered in this MVP gateway", false)
		return
	}
	c.JSON(http.StatusOK, response)
}

func blueprintIDBelongsToOrganization(workflowID, organizationID string) bool {
	return strings.HasPrefix(workflowID, "blueprint:"+organizationID+":")
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
		TemporalWorkflowType:  string(contracts.WorkflowTypeDynamic),
		TemporalStartRequired: false,
		PolicyStatus:          "deterministic-read-only-fixture",
		Permissions:           permissions,
		Blueprint:             request.Blueprint,
		Warnings:              warnings,
	}
}

func validateBlueprint(blueprint domain.WorkflowBlueprint) ([]domain.WorkflowPermissionRequirement, []string, error) {
	if err := contracts.Validate(contracts.SchemaWorkflowBlueprint, blueprint); err != nil {
		return nil, nil, fmt.Errorf("blueprint does not match canonical schema: %w", err)
	}
	if blueprint.ContractVersion != domain.WorkflowBlueprintContractVersion {
		return nil, nil, fmt.Errorf("unsupported blueprint contractVersion %q", blueprint.ContractVersion)
	}
	if blueprint.BlueprintID == "" || blueprint.Version == "" || strings.TrimSpace(blueprint.Name) == "" {
		return nil, nil, fmt.Errorf("blueprintId, version, and name are required")
	}
	if blueprint.WorkflowType != string(contracts.WorkflowTypeDynamic) {
		return nil, nil, fmt.Errorf("dynamic workflows must use workflowType %q", contracts.WorkflowTypeDynamic)
	}
	if len(blueprint.Steps) == 0 {
		return nil, nil, fmt.Errorf("blueprint must contain at least one step")
	}

	steps := make(map[string]domain.WorkflowStep, len(blueprint.Steps))
	allowedTools := make(map[string]struct{}, len(blueprint.AllowedTools))
	for _, tool := range blueprint.AllowedTools {
		allowedTools[tool] = struct{}{}
	}
	for _, step := range blueprint.Steps {
		if step.ID == "" {
			return nil, nil, fmt.Errorf("every step requires an id")
		}
		if _, exists := steps[step.ID]; exists {
			return nil, nil, fmt.Errorf("duplicate step id %q", step.ID)
		}
		switch step.Kind {
		case "tool":
			if step.Tool == "" {
				return nil, nil, fmt.Errorf("tool step %q requires a tool", step.ID)
			}
			if !knownCapability(step.Tool) {
				return nil, nil, fmt.Errorf("tool %q is not in the registered capability catalog", step.Tool)
			}
			if len(allowedTools) == 0 {
				return nil, nil, fmt.Errorf("tool steps require an explicit allowedTools manifest")
			}
			if _, allowed := allowedTools[step.Tool]; !allowed {
				return nil, nil, fmt.Errorf("tool %q is not allowed by the Blueprint manifest", step.Tool)
			}
		case "agent":
			if strings.TrimSpace(step.AgentDefinition) == "" {
				return nil, nil, fmt.Errorf("agent step %q requires an agentDefinition", step.ID)
			}
			if !knownAgentDefinition(step.AgentDefinition) {
				return nil, nil, fmt.Errorf("agent definition %q is not registered", step.AgentDefinition)
			}
		case "transform", "condition", "wait", "approval":
			if step.Kind == "condition" {
				if _, ok := step.Input["condition"].(bool); !ok {
					fromStep, fromStepOK := step.Input["fromStep"].(string)
					if !fromStepOK || strings.TrimSpace(fromStep) == "" {
						return nil, nil, fmt.Errorf("condition step %q requires boolean input.condition or fromStep", step.ID)
					}
				}
			}
			if step.Kind == "wait" {
				if duration, ok := step.Input["duration"].(string); !ok || strings.TrimSpace(duration) == "" {
					return nil, nil, fmt.Errorf("wait step %q requires input.duration", step.ID)
				}
			}
		default:
			return nil, nil, fmt.Errorf("step %q has unsupported kind %q", step.ID, step.Kind)
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
		if step.Kind == "condition" {
			if _, literal := step.Input["condition"].(bool); !literal {
				fromStep, _ := step.Input["fromStep"].(string)
				if !containsString(step.DependsOn, fromStep) {
					return nil, nil, fmt.Errorf("condition step %q must depend on fromStep %q", step.ID, fromStep)
				}
			}
		}

		if (blueprint.RequiresApproval || step.RequiresApproval) && (step.Kind == "tool" || step.Kind == "agent") && !hasApprovalAncestor(step.ID, steps) {
			return nil, nil, fmt.Errorf("step %q requires an approval step on its dependency path", step.ID)
		}
		if step.Kind != "tool" {
			continue
		}
		if capabilityRequiresApproval(step.Tool) && !hasApprovalAncestor(step.ID, steps) {
			return nil, nil, fmt.Errorf("step %q requires an approval step on its dependency path", step.ID)
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
	_, ok := capabilityByName(name)
	return ok
}

func knownAgentDefinition(name string) bool {
	return contracts.IsRegisteredAgentDefinition(name)
}

func capabilityRequiresApproval(tool string) bool {
	capability, ok := capabilityByName(tool)
	return ok && capability.ApprovalRequired
}

func hasApprovalAncestor(stepID string, steps map[string]domain.WorkflowStep) bool {
	seen := make(map[string]bool, len(steps))
	var visit func(string) bool
	visit = func(id string) bool {
		if seen[id] {
			return false
		}
		seen[id] = true
		step, ok := steps[id]
		if !ok {
			return false
		}
		for _, dependency := range step.DependsOn {
			dependencyStep, exists := steps[dependency]
			if exists && dependencyStep.Kind == "approval" {
				return true
			}
			if visit(dependency) {
				return true
			}
		}
		return false
	}
	return visit(stepID)
}

func capabilityByName(name string) (domain.WorkflowCapability, bool) {
	for _, capability := range workflowCapabilities {
		if capability.Name == name {
			return capability, true
		}
	}
	return domain.WorkflowCapability{}, false
}

func scopeSatisfies(scope domain.Scope, required []string) bool {
	for _, requirement := range required {
		switch requirement {
		case "ids":
			if len(scope.IDs) == 0 {
				return false
			}
		default:
			return false
		}
	}
	return true
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
