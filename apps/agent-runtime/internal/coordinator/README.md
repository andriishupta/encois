# Coordinator blueprint

This package is the first blueprint for the long-lived per-organization/project
Coordinator. It contains only durable orchestration state and deterministic
workflow-plan validation.

- `CoordinatorWorkflow` is logically long-lived and uses Temporal Signals,
  timers, and Continue-As-New.
- `BootstrapProjectWorkflow` is the short initial phase and calls the typed
  `CreateBootstrapPlan` Activity. Without a configured model it returns an
  explicit deferred status; ingestion, persistence, approval, and explicit
  Memory Bank generation remain separate Activities.
- `WorkflowCreator` validates model-proposed plans against the generic
  `encois.user-blueprint.v1` contract, approved capabilities, and authorized
  scopes. It does not generate Go code or write the control-plane database.
- The Gateway API owns registry persistence and Temporal Schedule API calls. An
  applied plan can explicitly request a start; the Coordinator then starts the
  approved immutable snapshot through a private Gateway Activity and retains
  failed starts for retry.

The Coordinator's broad context is still limited by organization/project scope
and Agent Gateway policy. It never receives connector secrets.
