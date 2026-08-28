package server

import (
	"fmt"
	"strings"
	"time"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	contracts "github.com/andriishupta/encois/packages/contracts"
)

func mockTool(request domain.ToolInvocationRequest) (map[string]any, []string, []contracts.SourceFreshness, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	input := providerInput(request.Arguments)
	switch request.Tool {
	case "jira.project_tasks":
		projectID := stringInput(input, "projectKey", "project", "projectId")
		if projectID == "" {
			return nil, nil, nil, fmt.Errorf("Jira projectKey is required")
		}
		return map[string]any{
			"source":         "jira",
			"organizationId": request.OrganizationID,
			"projectId":      projectID,
			"totalTasks":     10,
			"completedTasks": 8,
			"remainingTasks": 2,
			"blockedTasks":   1,
			"observedAt":     now,
		}, []string{"mock://organizations/" + request.OrganizationID + "/jira/project/" + projectID}, []contracts.SourceFreshness{{Source: "jira", ObservedAt: now, IngestedAt: now, Status: contracts.FreshnessFresh}}, nil
	case "github.project_activity", "github.repository_activity":
		repository := stringInput(input, "repository", "repositoryFullName", "repo", "projectKey")
		parts := strings.Split(repository, "/")
		if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
			return nil, nil, nil, fmt.Errorf("github repository must use owner/name format")
		}
		return map[string]any{
			"source":             "github",
			"organizationId":     request.OrganizationID,
			"projectId":          repository,
			"openPullRequests":   2,
			"failingChecks":      1,
			"commitsSinceCutoff": 12,
			"observedAt":         now,
		}, []string{"mock://organizations/" + request.OrganizationID + "/github/repository/" + repository}, []contracts.SourceFreshness{{Source: "github", ObservedAt: now, IngestedAt: now, Status: contracts.FreshnessFresh}}, nil
	default:
		return nil, nil, nil, ErrProviderToolUnavailable
	}
}

func mockToolProvenance(toolName, organizationID string, data map[string]any) *contracts.DataProvenance {
	source, _ := data["source"].(string)
	observedAt, _ := data["observedAt"].(string)
	projectID, _ := data["projectId"].(string)
	if source == "" || observedAt == "" || projectID == "" {
		return nil
	}
	return &contracts.DataProvenance{
		Source:                source,
		SourceID:              organizationID + ":" + source,
		SourceRecordID:        projectID,
		ObservedAt:            observedAt,
		TransformationVersion: "mock-provider-adapter.v1",
		Locator:               map[string]any{"tool": toolName},
	}
}
