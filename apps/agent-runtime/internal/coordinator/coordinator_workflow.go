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

func coordinatorStartActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    5,
		},
	}
}

// CoordinatorWorkflow is the logical per-organization/project control loop.
// Provider/model I/O and workflow creation belong in Activities or the Gateway API.
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
	pendingWorkflowStarts := make([]CoordinatorEvent, 0)
	for _, signalID := range state.ProcessedSignalIDs {
		processedSignalIDs[signalID] = true
	}

	for {
		shouldReconcile := initialReconcile
		initialReconcile = false
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
				case "workflow-start-requested":
					state.Status = StatusReconciling
					pendingWorkflowStarts = appendCoordinatorEventUnique(pendingWorkflowStarts, event)
				default:
					state.Status = StatusReconciling
				}
				if event.EventType == "integration-connected" && event.Key != "" {
					state.ConnectedIntegrationIDs = appendUnique(state.ConnectedIntegrationIDs, event.Key)
				}
				if event.EventType == "provider-changed" && event.Key != "" {
					state.ConnectedIntegrationIDs = removeValue(state.ConnectedIntegrationIDs, event.Key)
				}
				if event.WorkflowID != "" && event.EventType == "workflow-completed" {
					state.ActiveWorkflowIDs = removeValue(state.ActiveWorkflowIDs, event.WorkflowID)
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

		if len(pendingWorkflowStarts) > 0 {
			if err := startRequestedWorkflows(ctx, input, &state, pendingWorkflowStarts); err != nil {
				state.Status = StatusSuspended
				state.LastEvent = "workflow-start-failed"
				state.LastError = err.Error()
				continue
			}
			pendingWorkflowStarts = pendingWorkflowStarts[:0]
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

func startRequestedWorkflows(ctx workflow.Context, input CoordinatorStartInput, state *CoordinatorState, events []CoordinatorEvent) error {
	activityCtx := workflow.WithActivityOptions(ctx, coordinatorStartActivityOptions())
	for _, event := range events {
		request := ApprovedWorkflowStartInput{
			RequestID:        event.EventID,
			CoordinatorID:    input.CoordinatorID,
			OrganizationID:   input.OrganizationID,
			ActorID:          event.ActorID,
			PolicyVersion:    input.PolicyVersion,
			Scope:            event.Scope,
			BlueprintID:      event.BlueprintID,
			BlueprintVersion: event.BlueprintVersion,
			Key:              event.Key,
			BusinessInput:    event.BusinessInput,
			IdempotencyKey:   event.Key,
		}
		var result ApprovedWorkflowStartResult
		if err := workflow.ExecuteActivity(activityCtx, CoordinatorStartWorkflowActivityName, request).Get(ctx, &result); err != nil {
			return err
		}
		if result.WorkflowID == "" || result.WorkflowID != event.WorkflowID {
			return fmt.Errorf("started workflow identity does not match request")
		}
		state.ActiveWorkflowIDs = appendUnique(state.ActiveWorkflowIDs, result.WorkflowID)
	}
	state.Status = StatusReconciling
	state.LastEvent = "workflow-started"
	return nil
}

func appendCoordinatorEventUnique(events []CoordinatorEvent, candidate CoordinatorEvent) []CoordinatorEvent {
	for _, event := range events {
		if event.EventID == candidate.EventID {
			return events
		}
	}
	return append(events, candidate)
}

func reconcileCoordinator(ctx workflow.Context, input CoordinatorStartInput, state *CoordinatorState) error {
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
	return BootstrapProjectResult{
		ContractVersion: string(contractschemas.ContractBootstrapProject),
		Ready:           true,
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
