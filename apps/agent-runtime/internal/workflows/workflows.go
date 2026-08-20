package workflows

import (
	"fmt"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

func ReleaseRiskWorkflow(ctx workflow.Context, input ReleaseRiskInput) (ReleaseRiskResult, error) {
	if err := validateInput(input); err != nil {
		return ReleaseRiskResult{}, err
	}

	childOptions := workflow.ChildWorkflowOptions{
		ParentClosePolicy: enumspb.PARENT_CLOSE_POLICY_TERMINATE,
		WorkflowID:        input.WorkflowID + ":jira",
	}
	jiraFuture := workflow.ExecuteChildWorkflow(workflow.WithChildOptions(ctx, childOptions), JiraReleaseWorkflow, input)

	childOptions.WorkflowID = input.WorkflowID + ":github"
	githubFuture := workflow.ExecuteChildWorkflow(workflow.WithChildOptions(ctx, childOptions), GitHubReleaseWorkflow, input)

	var jira EvidenceBatch
	if err := jiraFuture.Get(ctx, &jira); err != nil {
		return ReleaseRiskResult{}, fmt.Errorf("jira specialist workflow: %w", err)
	}
	var github EvidenceBatch
	if err := githubFuture.Get(ctx, &github); err != nil {
		return ReleaseRiskResult{}, fmt.Errorf("github specialist workflow: %w", err)
	}

	activityContext := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 2},
	})
	var insight Insight
	if err := workflow.ExecuteActivity(activityContext, "SynthesizeReleaseRisk", SynthesisInput{
		Investigation: input,
		Jira:          jira,
		GitHub:        github,
	}).Get(activityContext, &insight); err != nil {
		return ReleaseRiskResult{}, fmt.Errorf("synthesize release risk: %w", err)
	}

	return ReleaseRiskResult{
		ContractVersion: "release-risk-result.v1",
		WorkflowID:      input.WorkflowID,
		InvestigationID: input.WorkflowID,
		Jira:            jira,
		GitHub:          github,
		Insight:         insight,
	}, nil
}

func JiraReleaseWorkflow(ctx workflow.Context, input ReleaseRiskInput) (EvidenceBatch, error) {
	if err := validateInput(input); err != nil {
		return EvidenceBatch{}, err
	}
	activityContext := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 20 * time.Second,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 2},
	})
	var result EvidenceBatch
	if err := workflow.ExecuteActivity(activityContext, "CollectJiraEvidence", input).Get(activityContext, &result); err != nil {
		return EvidenceBatch{}, err
	}
	return result, nil
}

func GitHubReleaseWorkflow(ctx workflow.Context, input ReleaseRiskInput) (EvidenceBatch, error) {
	if err := validateInput(input); err != nil {
		return EvidenceBatch{}, err
	}
	activityContext := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 20 * time.Second,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 2},
	})
	var result EvidenceBatch
	if err := workflow.ExecuteActivity(activityContext, "CollectGitHubEvidence", input).Get(activityContext, &result); err != nil {
		return EvidenceBatch{}, err
	}
	return result, nil
}

func validateInput(input ReleaseRiskInput) error {
	if input.ContractVersion != "release-investigation.v1" {
		return fmt.Errorf("unsupported contractVersion %q", input.ContractVersion)
	}
	if input.RequestID == "" || input.WorkflowID == "" || input.OrganizationID == "" || input.ReleaseID == "" {
		return fmt.Errorf("requestId, workflowId, organizationId, and releaseId are required")
	}
	return nil
}
