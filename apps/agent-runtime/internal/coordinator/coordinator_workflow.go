package coordinator

import (
	"errors"
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	contractschemas "github.com/andriishupta/encois/packages/contracts"
)

const coordinatorReconcileInterval = 24 * time.Hour

type onboardingStatusReportError struct {
	err error
}

func (e onboardingStatusReportError) Error() string {
	return e.err.Error()
}

func (e onboardingStatusReportError) Unwrap() error {
	return e.err
}

func coordinatorActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 1,
		},
	}
}

// CoordinatorWorkflow is the logical per-organization/project control loop.
// Provider/model I/O and plan application belong in Activities or the Gateway API.
func CoordinatorWorkflow(ctx workflow.Context, input CoordinatorStartInput) error {
	state := input.State
	if state.Status == "" {
		state.Status = StatusOnboarding
	}
	input.State = state
	if err := ValidateCoordinatorStartInput(input); err != nil {
		return err
	}
	initialReconcile := state.Status == StatusOnboarding && !state.OnboardingComplete
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
	processedSignalIDs := make(map[string]bool, len(state.ProcessedSignalIDs))
	for _, signalID := range state.ProcessedSignalIDs {
		processedSignalIDs[signalID] = true
	}

	for {
		shouldReconcile := initialReconcile
		initialReconcile = false
		pendingStarts := append([]WorkflowStartSpec(nil), state.PendingWorkflowStarts...)
		if !shouldReconcile {
			timerCtx, cancelTimer := workflow.WithCancel(ctx)
			reconcileTimer := workflow.NewTimer(timerCtx, coordinatorReconcileInterval)
			selector := workflow.NewSelector(ctx)

			selector.AddReceive(integrationCh, func(channel workflow.ReceiveChannel, _ bool) {
				var signal CoordinatorSignal
				channel.Receive(ctx, &signal)
				if !acceptCoordinatorSignal(signal, &state, processedSignalIDs) {
					return
				}
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
				if !acceptCoordinatorSignal(signal, &state, processedSignalIDs) {
					return
				}
				state.LastEvent = SignalSourceReady
				state.Status = StatusBootstrapping
				shouldReconcile = true
			})
			selector.AddReceive(reconcileCh, func(channel workflow.ReceiveChannel, _ bool) {
				var signal CoordinatorSignal
				channel.Receive(ctx, &signal)
				if !acceptCoordinatorSignal(signal, &state, processedSignalIDs) {
					return
				}
				state.LastEvent = SignalReconcile
				state.Status = StatusReconciling
				shouldReconcile = true
			})
			selector.AddReceive(workflowCompletedCh, func(channel workflow.ReceiveChannel, _ bool) {
				var signal CoordinatorSignal
				channel.Receive(ctx, &signal)
				if !acceptCoordinatorSignal(signal, &state, processedSignalIDs) {
					return
				}
				state.LastEvent = SignalWorkflowCompleted
				state.Status = StatusReconciling
				shouldReconcile = true
			})
			selector.AddReceive(providerChangedCh, func(channel workflow.ReceiveChannel, _ bool) {
				var signal CoordinatorSignal
				channel.Receive(ctx, &signal)
				if !acceptCoordinatorSignal(signal, &state, processedSignalIDs) {
					return
				}
				state.LastEvent = SignalProviderChanged
				state.Status = StatusReconciling
				shouldReconcile = true
			})
			selector.AddReceive(approvalCh, func(channel workflow.ReceiveChannel, _ bool) {
				var signal CoordinatorSignal
				channel.Receive(ctx, &signal)
				if !acceptCoordinatorSignal(signal, &state, processedSignalIDs) {
					return
				}
				state.LastEvent = SignalApprovalResolved
				state.Status = StatusReconciling
				shouldReconcile = true
			})
			selector.AddReceive(eventCh, func(channel workflow.ReceiveChannel, _ bool) {
				var event CoordinatorEvent
				channel.Receive(ctx, &event)
				if err := ValidateCoordinatorEvent(event); err != nil {
					state.LastEvent = "invalid-coordinator-event"
					return
				}
				if event.OrganizationID != "" && event.OrganizationID != input.OrganizationID {
					return
				}
				if event.CoordinatorID != "" && event.CoordinatorID != input.CoordinatorID {
					return
				}
				if event.EventID == "" || contains(state.ProcessedEventIDs, event.EventID) {
					return
				}
				if processedSignalIDs[event.EventID] {
					return
				}
				processedSignalIDs[event.EventID] = true
				state.ProcessedSignalIDs = rememberEvent(state.ProcessedSignalIDs, event.EventID)
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
		}
		state.Version++
		state.ReconciliationCount++

		if len(pendingStarts) > 0 {
			state.PendingWorkflowStarts = pendingStarts
			if err := startApprovedWorkflows(ctx, input, &state, pendingStarts); err != nil {
				state.Status = StatusSuspended
				state.LastEvent = "approved-workflow-start-failed"
				state.LastError = err.Error()
				continue
			}
			state.PendingWorkflowStarts = nil
		}

		if shouldReconcile {
			state.LastError = ""
			if err := reconcileCoordinator(ctx, input, &state); err != nil {
				// Keep the long-lived Coordinator alive after a bounded Activity
				// failure. A later Signal or timer can retry reconciliation.
				state.Status = StatusSuspended
				state.LastEvent = "reconciliation-failed"
				state.LastError = err.Error()
				var statusReportErr onboardingStatusReportError
				if !errors.As(err, &statusReportErr) && !state.OnboardingComplete {
					if reportErr := reportOnboardingStatus(ctx, input, OnboardingStatusUpdate{Status: "failed", LastError: err.Error()}); reportErr != nil {
						state.LastError = fmt.Sprintf("%s; failed to persist onboarding status: %v", state.LastError, reportErr)
					}
				}
			}
		}

		// The server can suggest Continue-As-New as history grows. The counter is
		// a deterministic safety valve for local development and tests.
		if workflow.GetInfo(ctx).GetContinueAsNewSuggested() || state.ReconciliationCount >= 30 {
			state.ReconciliationCount = 0
			return workflow.NewContinueAsNewError(ctx, CoordinatorWorkflow, CoordinatorStartInput{
				ContractVersion:      input.ContractVersion,
				CoordinatorID:        input.CoordinatorID,
				OrganizationID:       input.OrganizationID,
				ProjectID:            input.ProjectID,
				ScopeType:            input.ScopeType,
				Scope:                input.Scope,
				ActorID:              input.ActorID,
				PolicyVersion:        input.PolicyVersion,
				CoordinationMode:     input.CoordinationMode,
				SelectedWorkflowRefs: append([]string(nil), input.SelectedWorkflowRefs...),
				State:                state,
			})
		}
	}
}

func startApprovedWorkflows(ctx workflow.Context, input CoordinatorStartInput, state *CoordinatorState, starts []WorkflowStartSpec) error {
	activityCtx := workflow.WithActivityOptions(ctx, coordinatorActivityOptions())

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
	activityCtx := workflow.WithActivityOptions(ctx, coordinatorActivityOptions())

	if len(input.SelectedWorkflowRefs) == 0 {
		state.Status = StatusReady
		state.LastEvent = "onboarding-ready"
		if !state.OnboardingComplete {
			if err := reportOnboardingStatus(ctx, input, OnboardingStatusUpdate{Status: "ready"}); err != nil {
				return onboardingStatusReportError{err: fmt.Errorf("report onboarding ready status: %w", err)}
			}
			state.OnboardingComplete = true
		}
		return nil
	}

	var proposal CoordinatorPlanActivityResult
	if err := workflow.ExecuteActivity(activityCtx, CoordinatorPlanActivityName, input).Get(ctx, &proposal); err != nil {
		return err
	}
	if proposal.Status != "proposed" || proposal.Plan == nil {
		state.Status = StatusWaiting
		state.LastEvent = "onboarding-bootstrap-deferred"
		if !state.OnboardingComplete {
			status := proposal.Status
			if status == "" {
				status = "unknown"
			}
			if err := reportOnboardingStatus(ctx, input, OnboardingStatusUpdate{
				Status:    "failed",
				LastError: fmt.Sprintf("Coordinator bootstrap did not produce a plan (status: %s).", status),
			}); err != nil {
				return onboardingStatusReportError{err: fmt.Errorf("report onboarding failure status: %w", err)}
			}
		}
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
	if !state.OnboardingComplete {
		if err := reportOnboardingStatus(ctx, input, OnboardingStatusUpdate{Status: "ready"}); err != nil {
			return onboardingStatusReportError{err: fmt.Errorf("report onboarding ready status: %w", err)}
		}
		state.OnboardingComplete = true
		state.Status = StatusReady
		state.LastEvent = "onboarding-ready"
	}
	return nil
}

func reportOnboardingStatus(ctx workflow.Context, input CoordinatorStartInput, update OnboardingStatusUpdate) error {
	activityCtx := workflow.WithActivityOptions(ctx, coordinatorActivityOptions())
	update.CoordinatorID = input.CoordinatorID
	update.OrganizationID = input.OrganizationID
	update.ContractVersion = CoordinatorContractVersion
	return workflow.ExecuteActivity(activityCtx, CoordinatorOnboardingStatusActivityName, update).Get(ctx, nil)
}

func BootstrapProjectWorkflow(ctx workflow.Context, input BootstrapProjectInput) (BootstrapProjectResult, error) {
	if err := ValidateBootstrapProjectInput(input); err != nil {
		return BootstrapProjectResult{}, err
	}
	activityCtx := workflow.WithActivityOptions(ctx, coordinatorActivityOptions())
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

func acceptCoordinatorSignal(signal CoordinatorSignal, state *CoordinatorState, processed map[string]bool) bool {
	if err := ValidateCoordinatorSignal(signal); err != nil {
		state.LastEvent = "invalid-coordinator-signal"
		return false
	}
	if processed[signal.EventID] {
		return false
	}
	processed[signal.EventID] = true
	state.ProcessedSignalIDs = rememberEvent(state.ProcessedSignalIDs, signal.EventID)
	return true
}
