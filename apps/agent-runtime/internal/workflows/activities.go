package workflows

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/agents"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/gatewayclient"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/observability"
	contractschemas "github.com/andriishupta/encois/packages/contracts"
	"go.opentelemetry.io/otel/attribute"
	"go.temporal.io/sdk/activity"
)

type Activities struct {
	agentBundle  *agents.Bundle
	agentGateway *gatewayclient.Client
}

// ValidateBlueprintContract runs outside deterministic Workflow code and
// checks the same canonical schema consumed by the TypeScript API. The
// execution context has its own schema because the Blueprint contract is the
// workflow input envelope, not the context object itself.
func ValidateBlueprintContract(_ context.Context, input BlueprintWorkflowInput) error {
	if !workflowIDBelongsToOrganization(input.WorkflowID, input.OrganizationID) {
		return fmt.Errorf("workflow id is outside the organization scope")
	}
	blueprint := input.Blueprint
	if blueprint.WorkflowType == "" {
		blueprint = input.Payload
	}
	if err := contractschemas.Validate(contractschemas.SchemaWorkflowBlueprint, blueprint); err != nil {
		return fmt.Errorf("validate blueprint contract: %w", err)
	}
	executionContext := map[string]any{
		"contractVersion": string(contractschemas.ContractExecutionContext),
		"requestId":       input.RequestID,
		"workflowId":      input.WorkflowID,
		"organizationId":  input.OrganizationID,
		"actorId":         input.ActorID,
		"policyVersion":   input.PolicyVersion,
		"capability":      input.Capability,
		"scope":           input.Scope,
	}
	if input.TraceID != "" {
		executionContext["traceId"] = input.TraceID
	}
	return contractschemas.Validate(contractschemas.SchemaExecutionContext, executionContext)
}

// ValidateBlueprintResult keeps the result contract check at the Go boundary
// before Temporal returns the result to the control plane.
func ValidateBlueprintResult(_ context.Context, result BlueprintWorkflowResult) error {
	if err := contractschemas.Validate(contractschemas.SchemaWorkflowResult, result); err != nil {
		return fmt.Errorf("validate blueprint result: %w", err)
	}
	return nil
}

func NewActivities(agentBundle *agents.Bundle, agentGatewayURL string, serviceToken ...string) *Activities {
	var client *gatewayclient.Client
	if agentGatewayURL != "" {
		if len(serviceToken) > 1 {
			client = gatewayclient.NewWithAudience(agentGatewayURL, serviceToken[0], serviceToken[1])
		} else {
			client = gatewayclient.New(agentGatewayURL, serviceToken...)
		}
	}
	return &Activities{agentBundle: agentBundle, agentGateway: client}
}

func (a *Activities) ExecuteBlueprintStep(ctx context.Context, input BlueprintStepInput) (BlueprintStepResult, error) {
	ctx, span := observability.StartSpan(ctx, "agent-runtime.blueprint.step", attribute.String("encois.step_id", input.Step.ID), attribute.String("encois.step_kind", string(input.Step.Kind)))
	defer span.End()
	startedAt := time.Now()
	switch input.Step.Kind {
	case "tool":
		if a.agentGateway == nil {
			return BlueprintStepResult{
				StepID:       input.Step.ID,
				Status:       string(contractschemas.WorkflowResultWaiting),
				StatusReason: contractschemas.ReasonCapabilityMissing,
			}, nil
		}
		result, err := a.agentGateway.Invoke(ctx, gatewayclient.ToolRequest{
			ContractVersion:  string(contractschemas.ContractToolRequest),
			RequestID:        input.RequestID,
			TraceID:          input.TraceID,
			WorkflowID:       input.WorkflowID,
			RunID:            input.RunID,
			OrganizationID:   input.OrganizationID,
			ActorID:          input.ActorID,
			PolicyVersion:    input.PolicyVersion,
			Scope:            input.Scope,
			Capability:       input.Capability,
			AgentDefinition:  input.Step.AgentDefinition,
			BlueprintID:      input.BlueprintID,
			BlueprintVersion: input.BlueprintVersion,
			AllowedTools:     append([]string(nil), input.AllowedTools...),
			Tool:             input.Step.Tool,
			Arguments:        map[string]any{"input": input.Step.Input, "businessInput": input.BusinessInput, "priorResults": input.PriorResults},
		})
		if err != nil {
			return BlueprintStepResult{}, err
		}
		return BlueprintStepResult{StepID: input.Step.ID, Status: result.Status, Data: result.Data, EvidenceRefs: result.EvidenceRefs, Provenance: result.Provenance, Confidence: result.Confidence, Trace: executionTrace(ctx, startedAt, result.Status, input.Step.Tool, result.Provenance, ""), Freshness: result.Freshness}, nil
	case "agent":
		if a.agentBundle == nil || !a.agentBundle.Enabled || (a.agentBundle.Mode != agents.ModeMock && a.agentBundle.AgentModel == nil) {
			return BlueprintStepResult{
				StepID:       input.Step.ID,
				Status:       string(contractschemas.WorkflowResultWaiting),
				StatusReason: contractschemas.ReasonCapabilityMissing,
			}, nil
		}
		modelInput := map[string]any{
			"input":        input.Step.Input,
			"priorResults": input.PriorResults,
		}
		if a.agentGateway == nil {
			return BlueprintStepResult{StepID: input.Step.ID, Status: string(contractschemas.WorkflowResultWaiting), StatusReason: contractschemas.ReasonCapabilityMissing}, nil
		}
		graph, err := a.agentGateway.QueryGraph(ctx, gatewayclient.GraphQueryRequest{
			ContractVersion: string(contractschemas.ContractGraphQuery),
			RequestID:       input.RequestID + ":graph:" + input.Step.ID,
			TraceID:         input.TraceID,
			WorkflowID:      input.WorkflowID,
			RunID:           input.RunID,
			OrganizationID:  input.OrganizationID,
			ActorID:         input.ActorID,
			PolicyVersion:   input.PolicyVersion,
			Scope:           input.Scope,
			Capability:      input.Capability,
			Query:           graphQueryForStep(input.Step),
			Params:          graphParamsForStep(input.Step),
		})
		if err != nil {
			return BlueprintStepResult{}, fmt.Errorf("query graph evidence for agent step: %w", err)
		}
		if graph.Status != string(contractschemas.GraphStatusCompleted) {
			return BlueprintStepResult{StepID: input.Step.ID, Status: string(contractschemas.WorkflowResultWaiting), StatusReason: contractschemas.ReasonDegradedEvidence, EvidenceRefs: graph.EvidenceRefs, Freshness: graph.Freshness}, nil
		}
		modelInput["graph"] = graph
		summary, err := a.agentBundle.RunAgentStep(ctx, input.WorkflowID+":"+input.Step.ID, input.Step.AgentDefinition, modelInput)
		if err != nil {
			return BlueprintStepResult{}, err
		}
		agentResult, err := agents.DecodeAgentResult(summary)
		if err != nil {
			return BlueprintStepResult{}, err
		}
		if err := validateAgentEvidence(agentResult, graph.EvidenceRefs, input.PriorResults); err != nil {
			return BlueprintStepResult{}, err
		}
		stepStatus, statusReason := agents.AgentResultStepStatus(agentResult)
		data := map[string]any{
			"summary":         agentResult.Summary,
			"resultStatus":    string(agentResult.Status),
			"sources":         agentResult.Sources,
			"evidence":        agentResult.Evidence,
			"warnings":        agentResult.Warnings,
			"agentResult":     agentResult,
			"agentDefinition": input.Step.AgentDefinition,
			"graphQuery":      graphQueryForStep(input.Step),
		}
		return BlueprintStepResult{
			StepID:       input.Step.ID,
			Status:       stepStatus,
			StatusReason: statusReason,
			Data:         data,
			EvidenceRefs: agentResultEvidenceRefs(agentResult),
			Freshness:    graph.Freshness,
			Trace:        executionTrace(ctx, startedAt, string(agentResult.Status), "", nil, agentModelName(a.agentBundle)),
		}, nil
	default:
		return BlueprintStepResult{}, fmt.Errorf("step kind %q is handled by the workflow, not an activity", input.Step.Kind)
	}
}

func validateAgentEvidence(
	result contractschemas.AgentResult,
	graphEvidenceRefs []string,
	priorResults map[string]BlueprintStepResult,
) error {
	allowed := make(map[string]struct{}, len(graphEvidenceRefs))
	for _, reference := range graphEvidenceRefs {
		allowed[reference] = struct{}{}
	}
	for _, prior := range priorResults {
		for _, reference := range prior.EvidenceRefs {
			allowed[reference] = struct{}{}
		}
	}
	for _, reference := range agentResultEvidenceRefs(result) {
		if _, ok := allowed[reference]; !ok {
			return fmt.Errorf("agent result referenced evidence outside the supplied scope: %q", reference)
		}
	}
	return nil
}

func agentResultEvidenceRefs(result contractschemas.AgentResult) []string {
	seen := make(map[string]struct{}, len(result.Sources)+len(result.Evidence))
	refs := make([]string, 0, len(result.Sources)+len(result.Evidence))
	add := func(reference string) {
		if reference == "" {
			return
		}
		if _, ok := seen[reference]; ok {
			return
		}
		seen[reference] = struct{}{}
		refs = append(refs, reference)
	}
	for _, reference := range result.Sources {
		add(reference)
	}
	for _, evidence := range result.Evidence {
		add(evidence.Reference)
	}
	return refs
}

func executionTrace(ctx context.Context, startedAt time.Time, outcome, tool string, provenance *contractschemas.DataProvenance, model string) *contractschemas.WorkflowTrace {
	attempt := int32(1)
	if activity.IsActivity(ctx) {
		attempt = activity.GetInfo(ctx).Attempt
	}
	if attempt < 1 {
		attempt = 1
	}
	provider := ""
	if provenance != nil {
		provider = provenance.Source
	}
	if provider == "" && tool != "" {
		if separator := strings.IndexByte(tool, '.'); separator > 0 {
			provider = tool[:separator]
		}
	}
	durationMs := time.Since(startedAt).Milliseconds()
	if durationMs < 0 {
		durationMs = 0
	}
	return &contractschemas.WorkflowTrace{
		Provider:   provider,
		Model:      model,
		DurationMs: durationMs,
		Attempt:    attempt,
		Outcome:    outcome,
		Redacted:   true,
	}
}

func agentModelName(bundle *agents.Bundle) string {
	if bundle == nil || bundle.Mode == agents.ModeMock {
		return ""
	}
	return bundle.ModelName
}

func graphQueryForStep(step coordinator.WorkflowStep) string {
	if value, ok := step.Input["graphQuery"].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return "all_context"
}

func graphParamsForStep(step coordinator.WorkflowStep) map[string]any {
	params := make(map[string]any)
	if raw, ok := step.Input["graphParams"].(map[string]any); ok {
		for key, value := range raw {
			params[key] = value
		}
	}
	if _, ok := params["limit"]; !ok {
		params["limit"] = float64(100)
	}
	return params
}
