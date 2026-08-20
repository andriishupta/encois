package coordinator

import (
	"time"

	"go.temporal.io/sdk/workflow"
)

const coordinatorReconcileInterval = 24 * time.Hour

// CoordinatorWorkflow is the logical per-organization/project control loop.
// Provider/model I/O and plan application belong in Activities or the Gateway API.
func CoordinatorWorkflow(ctx workflow.Context, input CoordinatorStartInput) error {
	state := input.State
	if state.Status == "" {
		state.Status = StatusOnboarding
	}

	integrationCh := workflow.GetSignalChannel(ctx, SignalIntegrationConnected)
	sourceReadyCh := workflow.GetSignalChannel(ctx, SignalSourceReady)
	reconcileCh := workflow.GetSignalChannel(ctx, SignalReconcile)
	workflowCompletedCh := workflow.GetSignalChannel(ctx, SignalWorkflowCompleted)
	providerChangedCh := workflow.GetSignalChannel(ctx, SignalProviderChanged)
	approvalCh := workflow.GetSignalChannel(ctx, SignalApprovalResolved)

	for {
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
		})
		selector.AddReceive(sourceReadyCh, func(channel workflow.ReceiveChannel, _ bool) {
			var signal CoordinatorSignal
			channel.Receive(ctx, &signal)
			state.LastEvent = SignalSourceReady
			state.Status = StatusBootstrapping
		})
		selector.AddReceive(reconcileCh, func(channel workflow.ReceiveChannel, _ bool) {
			var signal CoordinatorSignal
			channel.Receive(ctx, &signal)
			state.LastEvent = SignalReconcile
			state.Status = StatusReconciling
		})
		selector.AddReceive(workflowCompletedCh, func(channel workflow.ReceiveChannel, _ bool) {
			var signal CoordinatorSignal
			channel.Receive(ctx, &signal)
			state.LastEvent = SignalWorkflowCompleted
			state.Status = StatusReconciling
		})
		selector.AddReceive(providerChangedCh, func(channel workflow.ReceiveChannel, _ bool) {
			var signal CoordinatorSignal
			channel.Receive(ctx, &signal)
			state.LastEvent = SignalProviderChanged
			state.Status = StatusReconciling
		})
		selector.AddReceive(approvalCh, func(channel workflow.ReceiveChannel, _ bool) {
			var signal CoordinatorSignal
			channel.Receive(ctx, &signal)
			state.LastEvent = SignalApprovalResolved
			state.Status = StatusReconciling
		})
		selector.AddFuture(reconcileTimer, func(workflow.Future) {
			state.LastEvent = "scheduled-reconcile"
			state.Status = StatusReconciling
		})

		selector.Select(ctx)
		cancelTimer()
		state.Version++
		state.ReconciliationCount++

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

func BootstrapProjectWorkflow(ctx workflow.Context, input BootstrapProjectInput) (BootstrapProjectResult, error) {
	_ = ctx
	_ = input
	// TODO: add source discovery, normalization, explicit Memory Bank memory
	// generation, and typed WorkflowChangePlan submission as Activities.
	return BootstrapProjectResult{
		ContractVersion: "bootstrap-project.v1",
		Ready:           false,
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
