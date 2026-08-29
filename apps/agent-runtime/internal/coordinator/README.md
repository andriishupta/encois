# Coordinator blueprint

This package is the first blueprint for the long-lived per-organization/project
Coordinator. It contains only durable orchestration state and deterministic
onboarding state plus deterministic contract validation.

- `CoordinatorWorkflow` is logically long-lived and uses Temporal Signals,
  timers, and Continue-As-New.
- `BootstrapProjectWorkflow` is the short initial phase and reports a validated
  ready result; ingestion, persistence, and Memory Bank generation remain
  separate Activities.
- `workflow-start-requested` events arrive through the Gateway outbox; the
  Coordinator invokes the private Gateway Activity to start only an approved
  Blueprint snapshot.
- The Gateway API owns Blueprint persistence and the final Temporal start call.

The Coordinator's broad context is still limited by organization/project scope
and Agent Gateway policy. It never receives connector secrets.
