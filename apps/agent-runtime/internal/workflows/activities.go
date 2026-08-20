package workflows

import (
	"context"
	"fmt"
	"time"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/agents"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/gatewayclient"
)

type Activities struct {
	agentBundle  *agents.Bundle
	agentGateway *gatewayclient.Client
}

func NewActivities(agentBundle *agents.Bundle, agentGatewayURL string) *Activities {
	var client *gatewayclient.Client
	if agentGatewayURL != "" {
		client = gatewayclient.New(agentGatewayURL)
	}
	return &Activities{agentBundle: agentBundle, agentGateway: client}
}

func (a *Activities) ExecuteBlueprintStep(ctx context.Context, input BlueprintStepInput) (BlueprintStepResult, error) {
	if input.Step.Kind != "tool" {
		return BlueprintStepResult{}, fmt.Errorf("unsupported blueprint step kind %q", input.Step.Kind)
	}
	if a.agentGateway == nil {
		return BlueprintStepResult{StepID: input.Step.ID, Status: "deferred-no-agent-gateway"}, nil
	}

	result, err := a.agentGateway.Invoke(ctx, gatewayclient.ToolRequest{
		ContractVersion: "tool-request.v1",
		RequestID:       input.RequestID,
		WorkflowID:      input.WorkflowID,
		OrganizationID:  input.OrganizationID,
		ActorID:         input.ActorID,
		PolicyVersion:   input.PolicyVersion,
		AgentDefinition: input.Step.AgentDefinition,
		Tool:            input.Step.Tool,
		Input:           input.Step.Input,
	})
	if err != nil {
		return BlueprintStepResult{}, err
	}
	return BlueprintStepResult{StepID: input.Step.ID, Status: result.Status, Data: result.Data, EvidenceRefs: result.EvidenceRefs}, nil
}

func (a *Activities) CollectJiraEvidence(ctx context.Context, input ReleaseRiskInput) (EvidenceBatch, error) {
	if a.agentGateway != nil {
		result, err := a.agentGateway.Invoke(ctx, gatewayRequest(input, "jira.release_tasks"))
		if err != nil {
			return EvidenceBatch{}, err
		}
		return EvidenceBatch{
			ContractVersion: "evidence-batch-ref.v1",
			BatchID:         "gateway:" + input.RequestID + ":jira",
			Source:          "jira",
			ReleaseID:       input.ReleaseID,
			ObservedAt:      time.Now().UTC().Format(time.RFC3339),
			Facts:           result.Data,
			EvidenceRefs:    result.EvidenceRefs,
		}, nil
	}
	return EvidenceBatch{
		ContractVersion: "evidence-batch-ref.v1",
		BatchID:         "mock:" + input.RequestID + ":jira",
		Source:          "jira",
		ReleaseID:       input.ReleaseID,
		ObservedAt:      time.Now().UTC().Format(time.RFC3339),
		Facts: map[string]any{
			"totalTasks":     10,
			"completedTasks": 8,
			"remainingTasks": 2,
			"blockedTasks":   1,
		},
		EvidenceRefs: []string{"mock:jira:" + input.ReleaseID},
	}, nil
}

func (a *Activities) CollectGitHubEvidence(ctx context.Context, input ReleaseRiskInput) (EvidenceBatch, error) {
	if a.agentGateway != nil {
		result, err := a.agentGateway.Invoke(ctx, gatewayRequest(input, "github.release_activity"))
		if err != nil {
			return EvidenceBatch{}, err
		}
		return EvidenceBatch{
			ContractVersion: "evidence-batch-ref.v1",
			BatchID:         "gateway:" + input.RequestID + ":github",
			Source:          "github",
			ReleaseID:       input.ReleaseID,
			ObservedAt:      time.Now().UTC().Format(time.RFC3339),
			Facts:           result.Data,
			EvidenceRefs:    result.EvidenceRefs,
		}, nil
	}
	return EvidenceBatch{
		ContractVersion: "evidence-batch-ref.v1",
		BatchID:         "mock:" + input.RequestID + ":github",
		Source:          "github",
		ReleaseID:       input.ReleaseID,
		ObservedAt:      time.Now().UTC().Format(time.RFC3339),
		Facts: map[string]any{
			"openPullRequests":   2,
			"failingChecks":      1,
			"commitsSinceCutoff": 12,
		},
		EvidenceRefs: []string{"mock:github:" + input.ReleaseID},
	}, nil
}

func gatewayRequest(input ReleaseRiskInput, toolName string) gatewayclient.ToolRequest {
	return gatewayclient.ToolRequest{
		ContractVersion: "tool-request.v1",
		RequestID:       input.RequestID,
		WorkflowID:      input.WorkflowID,
		OrganizationID:  input.OrganizationID,
		ActorID:         input.ActorID,
		PolicyVersion:   input.PolicyVersion,
		AgentDefinition: toolName + "@mock",
		Tool:            toolName,
		Input:           map[string]any{"releaseId": input.ReleaseID},
	}
}

func (a *Activities) SynthesizeReleaseRisk(ctx context.Context, input SynthesisInput) (Insight, error) {
	evidenceRefs := append(append([]string{}, input.Jira.EvidenceRefs...), input.GitHub.EvidenceRefs...)
	if a.agentBundle != nil && a.agentBundle.Enabled {
		prompt := fmt.Sprintf("Assess release %s using only this evidence: Jira=%v; GitHub=%v. Return a concise risk assessment with no invented facts.", input.Investigation.ReleaseID, input.Jira.Facts, input.GitHub.Facts)
		summary, err := a.agentBundle.Summarize(ctx, input.Investigation.WorkflowID+":synthesis", prompt)
		if err != nil {
			return Insight{}, err
		}
		return Insight{
			ContractVersion: "insight.v1",
			Status:          "model-generated",
			Risk:            "review",
			Confidence:      "model-assessed",
			Summary:         summary,
			EvidenceRefs:    evidenceRefs,
		}, nil
	}
	return Insight{
		ContractVersion: "insight.v1",
		Status:          "mocked",
		Risk:            "review",
		Confidence:      "high-for-fixture",
		Summary:         "Mock release evidence shows 8 of 10 Jira tasks complete, with 2 remaining and 1 blocked; GitHub reports 2 open pull requests and 1 failing check.",
		EvidenceRefs:    evidenceRefs,
	}, nil
}
