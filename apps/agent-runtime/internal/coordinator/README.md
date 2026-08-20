# Coordinator blueprint

This package is the first blueprint for the long-lived per-organization/project
Coordinator. It contains only durable orchestration state and deterministic
workflow-plan validation.

- `CoordinatorWorkflow` is logically long-lived and uses Temporal Signals,
  timers, and Continue-As-New.
- `BootstrapProjectWorkflow` is the short initial phase and is intentionally
  empty until ingestion and explicit Memory Bank generation Activities exist.
- `WorkflowCreator` validates model-proposed plans against the generic
  `encois.user-blueprint.v1` contract, approved capabilities, and authorized
  scopes. It does not generate Go code or write the control-plane database.
- The Gateway API owns registry persistence and Temporal Schedule API calls.

The Coordinator's broad context is still limited by organization/project scope
and Agent Gateway policy. It never receives connector secrets.
