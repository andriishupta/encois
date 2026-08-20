package workflows

import (
	"context"
	"testing"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/agents"
)

func TestMockEvidenceActivities(t *testing.T) {
	activities := NewActivities(&agents.Bundle{}, "")
	input := ReleaseRiskInput{
		ContractVersion: "release-investigation.v1",
		RequestID:       "req-test",
		WorkflowID:      "release-risk:test",
		OrganizationID:  "org-test",
		ReleaseID:       "release-test",
	}

	jira, err := activities.CollectJiraEvidence(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if jira.Facts["totalTasks"] != 10 || jira.Facts["completedTasks"] != 8 {
		t.Fatalf("unexpected Jira fixture: %+v", jira.Facts)
	}

	github, err := activities.CollectGitHubEvidence(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if github.Facts["openPullRequests"] != 2 || github.Facts["failingChecks"] != 1 {
		t.Fatalf("unexpected GitHub fixture: %+v", github.Facts)
	}
}

func TestValidateInput(t *testing.T) {
	if err := validateInput(ReleaseRiskInput{ContractVersion: "wrong"}); err == nil {
		t.Fatal("expected invalid contract version")
	}
}
