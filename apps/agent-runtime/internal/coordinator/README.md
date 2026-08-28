# Coordinator blueprint

This package is the first blueprint for the long-lived per-organization/project
Coordinator. It contains only durable orchestration state and deterministic
onboarding state and deterministic contract validation.

- `CoordinatorWorkflow` is logically long-lived and uses Temporal Signals,
  timers, and Continue-As-New.
- `BootstrapProjectWorkflow` is the short initial phase and reports a validated
  ready result; ingestion, persistence, and Memory Bank generation remain
  separate Activities.
- The Gateway API owns Blueprint persistence and Temporal Workflow start calls.

The Coordinator's broad context is still limited by organization/project scope
and Agent Gateway policy. It never receives connector secrets.
