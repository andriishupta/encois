package coordinator

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	contractschemas "github.com/andriishupta/encois/packages/contracts"
)

const coordinatorReconcileInterval = 24 * time.Hour

// CoordinatorWorkflow is the logical per-organization/project control loop.
// Provider/model I/O and plan application belong in Activities or the Gateway API.
func CoordinatorWorkflow(ctx workflow.Context, input CoordinatorStartInput) error {
	state := input.State
	if state.Status == "" {
		state.Status = StatusOnboarding
	}
	if err := workflow.SetQueryHandler(ctx, CoordinatorStateQueryName, func() (CoordinatorState, error) {
		return state, nil
	}); err != nil {
		return err
	}

	integrationCh := workflow.GetSignalChannel(ctx, SignalIntegrationConnected)
	sourceReadyCh := workflow.GetSignalChannel(ctx, SignalSourceReady)
	reconcileCh := workflow.GetSignalChannel(ctx, SignalReconcile)
	workflowCompletedCh := workflow.GetSignalChannel(ctx, SignalWorkflowCompleted)
	providerChangedCh := workflow.GetSignalChannel(ctx, SignalProviderChanged)
	approvalCh := workflow.GetSignalChannel(ctx, SignalApprovalResolved)
	eventCh := workflow.GetSignalChannel(ctx, SignalCoordinatorEvent)

	for {
		shouldReconcile := false
		pendingStarts := append([]WorkflowStartSpec(nil), state.PendingWorkflowStarts...)
		timerCtx, cancelTimer := workflow.WithCancel(ctx)
		reconcileTimer := workflow.NewTimer(timerCtx, coordinatorReconcileInterval)
		selector := workflow.NewSelector(ctx)

		selector.AddReceive(integrationCh, func(channel workflow.ReceiveChannel, _ bool) {
			var signal CoordinatorSignal
			channel.Receive(ctx, &signal)
			state.LastEvent = SignalIntegrationConnected
			if signal.SourceID != "" {
				state.ConnectedIntegrationIDs = appendUnique(state.ConnectedIntegrationIDs, signal.SourceID)
			}
			state.Status = StatusBootstrapping
			shouldReconcile = true
		})
		selector.AddReceive(sourceReadyCh, func(channel workflow.ReceiveChannel, _ bool) {
			var signal CoordinatorSignal
			channel.Receive(ctx, &signal)
			state.LastEvent = SignalSourceReady
			state.Status = StatusBootstrapping
			shouldReconcile = true
		})
		selector.AddReceive(reconcileCh, func(channel workflow.ReceiveChannel, _ bool) {
			var signal CoordinatorSignal
			channel.Receive(ctx, &signal)
			state.LastEvent = SignalReconcile
			state.Status = StatusReconciling
			shouldReconcile = true
		})
		selector.AddReceive(workflowCompletedCh, func(channel workflow.ReceiveChannel, _ bool) {
			var signal CoordinatorSignal
			channel.Receive(ctx, &signal)
			state.LastEvent = SignalWorkflowCompleted
			state.Status = StatusReconciling
			shouldReconcile = true
		})
		selector.AddReceive(providerChangedCh, func(channel workflow.ReceiveChannel, _ bool) {
			var signal CoordinatorSignal
			channel.Receive(ctx, &signal)
			state.LastEvent = SignalProviderChanged
			state.Status = StatusReconciling
			shouldReconcile = true
		})
		selector.AddReceive(approvalCh, func(channel workflow.ReceiveChannel, _ bool) {
			var signal CoordinatorSignal
			channel.Receive(ctx, &signal)
			state.LastEvent = SignalApprovalResolved
			state.Status = StatusReconciling
			shouldReconcile = true
		})
		selector.AddReceive(eventCh, func(channel workflow.ReceiveChannel, _ bool) {
			var event CoordinatorEvent
			channel.Receive(ctx, &event)
			if event.OrganizationID != "" && event.OrganizationID != input.OrganizationID {
				return
			}
			if event.CoordinatorID != "" && event.CoordinatorID != input.CoordinatorID {
				return
			}
			if event.EventID == "" || contains(state.ProcessedEventIDs, event.EventID) {
				return
			}
			state.ProcessedEventIDs = rememberEvent(state.ProcessedEventIDs, event.EventID)
			state.LastEvent = event.EventType
			switch event.EventType {
			case "integration-connected", "source-ready":
				state.Status = StatusBootstrapping
			default:
				state.Status = StatusReconciling
			}
			if event.PlanID != "" && (event.EventType == "workflow-plan-applied" || event.EventType == "workflow-plan-approved") {
				state.PendingPlanIDs = removeValue(state.PendingPlanIDs, event.PlanID)
			}
			if event.WorkflowID != "" && event.EventType == "workflow-completed" {
				state.ActiveWorkflowIDs = removeValue(state.ActiveWorkflowIDs, event.WorkflowID)
			}
			if event.EventType == "workflow-plan-applied" {
				for _, start := range event.WorkflowStarts {
					pendingStarts = appendWorkflowStartUnique(pendingStarts, start)
				}
			}
			shouldReconcile = true
		})
		selector.AddFuture(reconcileTimer, func(workflow.Future) {
			state.LastEvent = "scheduled-reconcile"
			state.Status = StatusReconciling
			shouldReconcile = true
		})

		selector.Select(ctx)
		cancelTimer()
		state.Version++
		state.ReconciliationCount++

		if len(pendingStarts) > 0 {
			state.PendingWorkflowStarts = pendingStarts
			if err := startApprovedWorkflows(ctx, input, &state, pendingStarts); err != nil {
				state.Status = StatusSuspended
				state.LastEvent = "approved-workflow-start-failed"
				continue
			}
			state.PendingWorkflowStarts = nil
		}

		if shouldReconcile {
			if err := reconcileCoordinator(ctx, input, &state); err != nil {
				// Keep the long-lived Coordinator alive after a bounded Activity
				// failure. A later Signal or timer can retry reconciliation.
				state.Status = StatusSuspended
				state.LastEvent = "reconciliation-failed"
			}
		}

		// The server can suggest Continue-As-New as history grows. The counter is
		// a deterministic safety valve for local development and tests.
		if workflow.GetInfo(ctx).GetContinueAsNewSuggested() || state.ReconciliationCount >= 30 {
			state.ReconciliationCount = 0
			return workflow.NewContinueAsNewError(ctx, CoordinatorWorkflow, CoordinatorStartInput{
				ContractVersion: input.ContractVersion,
				CoordinatorID:   input.CoordinatorID,
				OrganizationID:  input.OrganizationID,
				ProjectID:       input.ProjectID,
				ScopeType:       input.ScopeType,
				ActorID:         input.ActorID,
				PolicyVersion:   input.PolicyVersion,
				State:           state,
			})
		}
	}
}

func startApprovedWorkflows(ctx workflow.Context, input CoordinatorStartInput, state *CoordinatorState, starts []WorkflowStartSpec) error {
	activityCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2,
			MaximumAttempts:    2,
		},
	})

	for index, spec := range starts {
		if len(spec.Scope) == 0 {
			return fmt.Errorf("approved workflow start %q is missing organization-unit scope", spec.Key)
		}
		actorID := input.ActorID
		if actorID == "" {
			actorID = input.CoordinatorID
		}
		request := ApprovedWorkflowStartInput{
			RequestID:        fmt.Sprintf("coordinator-start:%s:%s:%s:%d", spec.BlueprintID, spec.BlueprintVersion, spec.Key, index),
			CoordinatorID:    input.CoordinatorID,
			OrganizationID:   input.OrganizationID,
			ProjectID:        input.ProjectID,
			ActorID:          actorID,
			PolicyVersion:    input.PolicyVersion,
			Scope:            spec.Scope,
			BlueprintID:      spec.BlueprintID,
			BlueprintVersion: spec.BlueprintVersion,
			Key:              spec.Key,
			BusinessInput:    spec.BusinessInput,
			IdempotencyKey:   fmt.Sprintf("coordinator-start:%s:%s:%s", spec.BlueprintID, spec.BlueprintVersion, spec.Key),
		}
		var result ApprovedWorkflowStartResult
		if err := workflow.ExecuteActivity(activityCtx, CoordinatorStartActivityName, request).Get(ctx, &result); err != nil {
			return err
		}
		if result.WorkflowID == "" {
			return fmt.Errorf("approved workflow start returned an empty workflow id")
		}
		state.ActiveWorkflowIDs = appendUnique(state.ActiveWorkflowIDs, result.WorkflowID)
	}
	state.Status = StatusReconciling
	state.LastEvent = "approved-workflow-started"
	return nil
}

func appendWorkflowStartUnique(values []WorkflowStartSpec, candidate WorkflowStartSpec) []WorkflowStartSpec {
	for _, existing := range values {
		if existing.BlueprintID == candidate.BlueprintID && existing.BlueprintVersion == candidate.BlueprintVersion && existing.Key == candidate.Key {
			return values
		}
	}
	return append(values, candidate)
}

func reconcileCoordinator(ctx workflow.Context, input CoordinatorStartInput, state *CoordinatorState) error {
	activityCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2,
			MaximumAttempts:    2,
		},
	})

	var proposal CoordinatorPlanActivityResult
	if err := workflow.ExecuteActivity(activityCtx, CoordinatorPlanActivityName, input).Get(ctx, &proposal); err != nil {
		return err
	}
	if proposal.Status != "proposed" || proposal.Plan == nil {
		state.Status = StatusWaiting
		state.LastEvent = "reconciliation-deferred"
		return nil
	}

	var submission PlanSubmissionResult
	if err := workflow.ExecuteActivity(activityCtx, CoordinatorSubmitActivityName, *proposal.Plan).Get(ctx, &submission); err != nil {
		return err
	}
	if submission.PlanID != "" {
		state.PendingPlanIDs = appendUnique(state.PendingPlanIDs, submission.PlanID)
	}
	state.Status = StatusWaiting
	state.LastEvent = "workflow-plan-submitted"
	return nil
}

func BootstrapProjectWorkflow(ctx workflow.Context, input BootstrapProjectInput) (BootstrapProjectResult, error) {
	activityCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2,
			MaximumAttempts:    2,
		},
	})
	var proposal BootstrapPlanActivityResult
	if err := workflow.ExecuteActivity(activityCtx, "CreateBootstrapPlan", input).Get(ctx, &proposal); err != nil {
		return BootstrapProjectResult{}, err
	}
	if proposal.Status != "proposed" || proposal.Plan == nil {
		return BootstrapProjectResult{ContractVersion: string(contractschemas.ContractBootstrapProject), Ready: false}, nil
	}
	if err := NewWorkflowCreator(nil).ValidatePlan(*proposal.Plan); err != nil {
		return BootstrapProjectResult{}, err
	}
	return BootstrapProjectResult{
		ContractVersion: string(contractschemas.ContractBootstrapProject),
		Ready:           true,
		EvidenceRefs:    proposal.Plan.EvidenceRefs,
		PlanID:          proposal.Plan.PlanID,
	}, nil
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func contains(values []string, value string) bool {
	for _, existing := range values {
		if existing == value {
			return true
		}
	}
	return false
}

func removeValue(values []string, value string) []string {
	filtered := values[:0]
	for _, existing := range values {
		if existing != value {
			filtered = append(filtered, existing)
		}
	}
	return filtered
}

func rememberEvent(values []string, value string) []string {
	values = append(values, value)
	if len(values) > 100 {
		values = values[len(values)-100:]
	}
	return values
}
