package server

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	contractschemas "github.com/andriishupta/encois/packages/contracts"
)

func (r *gcpProviderToolRegistry) githubActivity(ctx context.Context, request domain.ToolInvocationRequest, token string, input map[string]any) (ProviderToolResult, error) {
	repository := stringInput(input, "repository", "repositoryFullName", "repo", "projectKey")
	parts := strings.Split(repository, "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return ProviderToolResult{}, fmt.Errorf("github repository must use owner/name format")
	}
	owner, name := url.PathEscape(parts[0]), url.PathEscape(parts[1])
	base := "https://api.github.com/repos/" + owner + "/" + name
	pulls := make([]struct {
		Head struct {
			SHA string `json:"sha"`
		} `json:"head"`
	}, 0)
	if err := r.getJSON(ctx, token, base+"/pulls?state=open&per_page=100", &pulls, map[string]string{"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}); err != nil {
		return ProviderToolResult{}, fmt.Errorf("read GitHub pull requests: %w", err)
	}
	commits := make([]struct {
		SHA string `json:"sha"`
	}, 0)
	commitURL := base + "/commits?per_page=100"
	if since := stringInput(input, "since", "cutoff", "sinceAt"); since != "" {
		commitURL += "&since=" + url.QueryEscape(since)
	}
	if err := r.getJSON(ctx, token, commitURL, &commits, map[string]string{"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}); err != nil {
		return ProviderToolResult{}, fmt.Errorf("read GitHub commits: %w", err)
	}
	failingChecks := 0
	for index, pull := range pulls {
		if index >= 20 || pull.Head.SHA == "" {
			break
		}
		var checks struct {
			CheckRuns []struct {
				Conclusion string `json:"conclusion"`
			} `json:"check_runs"`
		}
		if err := r.getJSON(ctx, token, base+"/commits/"+url.PathEscape(pull.Head.SHA)+"/check-runs", &checks, map[string]string{"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}); err != nil {
			return ProviderToolResult{}, fmt.Errorf("read GitHub checks: %w", err)
		}
		for _, check := range checks.CheckRuns {
			if check.Conclusion != "" && check.Conclusion != "success" && check.Conclusion != "neutral" && check.Conclusion != "skipped" {
				failingChecks++
			}
		}
	}
	now := r.now().UTC().Format(time.RFC3339)
	return ProviderToolResult{
		Data: map[string]any{
			"source":             "github",
			"organizationId":     request.OrganizationID,
			"projectId":          repository,
			"openPullRequests":   len(pulls),
			"failingChecks":      failingChecks,
			"commitsSinceCutoff": len(commits),
			"observedAt":         now,
		},
		EvidenceRefs: []string{"github://" + repository},
		Provenance:   &contractschemas.DataProvenance{Source: "github", SourceRecordID: repository, ObservedAt: now, TransformationVersion: "github-provider-adapter.v1"},
		Freshness:    []contractschemas.SourceFreshness{{Source: "github", ObservedAt: now, IngestedAt: now, Status: contractschemas.FreshnessFresh}},
	}, nil
}

func (r *gcpProviderToolRegistry) jiraProjectTasks(ctx context.Context, request domain.ToolInvocationRequest, token string, tokenSet map[string]any, input map[string]any) (ProviderToolResult, error) {
	projectKey := stringInput(input, "projectKey", "project", "projectId")
	if projectKey == "" || strings.ContainsAny(projectKey, "\r\n") {
		return ProviderToolResult{}, fmt.Errorf("Jira projectKey is required")
	}
	base, ok := jiraBaseURL(tokenSet)
	if !ok {
		return ProviderToolResult{}, fmt.Errorf("Jira OAuth credential does not include an accessible cloud")
	}
	query := url.Values{}
	query.Set("jql", "project = \""+strings.ReplaceAll(projectKey, `"`, ``)+`" ORDER BY updated DESC`)
	query.Set("maxResults", "100")
	query.Set("fields", "status")
	var result struct {
		Total  int `json:"total"`
		Issues []struct {
			Fields struct {
				Status struct {
					Name           string `json:"name"`
					StatusCategory struct {
						Key string `json:"key"`
					} `json:"statusCategory"`
				} `json:"status"`
			} `json:"fields"`
		} `json:"issues"`
	}
	if err := r.getJSON(ctx, token, base+"/rest/api/3/search?"+query.Encode(), &result, map[string]string{"Accept": "application/json"}); err != nil {
		return ProviderToolResult{}, fmt.Errorf("read Jira tasks: %w", err)
	}
	completed, blocked := 0, 0
	for _, issue := range result.Issues {
		category := strings.ToLower(issue.Fields.Status.StatusCategory.Key)
		name := strings.ToLower(issue.Fields.Status.Name)
		if category == "done" {
			completed++
		}
		if strings.Contains(name, "block") || strings.Contains(name, "imped") {
			blocked++
		}
	}
	now := r.now().UTC().Format(time.RFC3339)
	return ProviderToolResult{
		Data: map[string]any{
			"source":         "jira",
			"organizationId": request.OrganizationID,
			"projectId":      projectKey,
			"totalTasks":     result.Total,
			"completedTasks": completed,
			"remainingTasks": result.Total - completed,
			"blockedTasks":   blocked,
			"observedAt":     now,
		},
		EvidenceRefs: []string{"jira://project/" + url.PathEscape(projectKey)},
		Provenance:   &contractschemas.DataProvenance{Source: "jira", SourceRecordID: projectKey, ObservedAt: now, TransformationVersion: "jira-provider-adapter.v1"},
		Freshness:    []contractschemas.SourceFreshness{{Source: "jira", ObservedAt: now, IngestedAt: now, Status: contractschemas.FreshnessFresh}},
	}, nil
}

func jiraBaseURL(tokenSet map[string]any) (string, bool) {
	if value, ok := tokenSetString(tokenSet, "api_base_url", "apiBaseUrl"); ok && strings.HasPrefix(value, "https://") {
		return strings.TrimRight(value, "/"), true
	}
	if cloudID, ok := tokenSetString(tokenSet, "cloud_id", "cloudId"); ok {
		return "https://api.atlassian.com/ex/jira/" + url.PathEscape(cloudID), true
	}
	if resources, ok := tokenSet["accessible_resources"].([]any); ok {
		for _, raw := range resources {
			resource, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			if cloudID, ok := tokenSetString(resource, "id"); ok {
				return "https://api.atlassian.com/ex/jira/" + url.PathEscape(cloudID), true
			}
		}
	}
	return "", false
}
