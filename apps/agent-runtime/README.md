# Encois Agent Runtime

The deployable Go worker application for Temporal Workflows, Activities, and
Google ADK agents. It is a Temporal Worker, not a public HTTP server.

## Run

Start the private Agent Gateway first, then a local Temporal server, and run:

```bash
go run ./cmd/agent-runtime
```

Configuration is environment-based:

- `TEMPORAL_HOST_PORT` — defaults to `127.0.0.1:7233`;
- `TEMPORAL_NAMESPACE` — defaults to `default`;
- `TEMPORAL_TASK_QUEUE` — defaults to `encois-agent-runtime`;
- `TEMPORAL_API_KEY` — optional Temporal Cloud API key;
- `AGENT_GATEWAY_URL` — defaults to `http://127.0.0.1:8080`;
- `GEMINI_API_KEY` or `GOOGLE_API_KEY` — optional for the local scaffold;
  without it ADK agent steps return a deferred status instead of calling
  Gemini;
- `GEMINI_MODEL` — defaults to `gemini-3.7-flash`.
- `GEMINI_COORDINATOR_MODEL` — defaults to `gemini-3.1-pro-preview`; used by
  the Coordinator and Workflow Creator instead of the lower-latency specialist
  model;
- `GEMINI_COORDINATOR_THINKING_LEVEL` — defaults to `high`; supported values
  are `low`, `medium`, and `high`.

The current skeleton:

- connect to Temporal Cloud and poll named task queues;
- hosts the Coordinator and Workflow Creator ADK capabilities with a stronger
  reasoning profile when Gemini is configured; user workflow agents are loaded
  from approved Agent Definitions at Blueprint execution time;
- keeps model calls and external I/O inside Activities;
- use versioned Temporal payloads and the private Agent Gateway boundary; and
- emit scoped, redacted runtime telemetry.

Registered workflows:

- `encois.user-blueprint.v1` — generic workflow that interprets a validated
  company-specific Blueprint and executes typed tool/agent steps;
- `CoordinatorWorkflow` — long-lived organization/project onboarding and
  reconciliation loop; uses Signals, timers, and Continue-As-New;
- `BootstrapProjectWorkflow` — short initial bootstrap phase.

The Coordinator's `WorkflowCreator` emits typed Blueprint plans. The Gateway
API validates tool/agent references, scope, policy, and compatibility before
persisting a Blueprint and starting `encois.user-blueprint.v1`.

Coordinator and Workflow Creator responses use the stronger model plus the
highest supported Gemini thinking level. Intermediate thoughts are not emitted
to users or logs; only the validated result is retained.

Tool Activities call the Agent Gateway over HTTP. The gateway currently
exposes two in-memory, read-only fixtures: 10 Jira tasks with 8 completed,
plus mock GitHub pull-request/check data. Agent steps currently run ADK
reasoning over their validated input and prior step results; provider tools
are invoked by explicit `tool` steps.

The generic interpreter currently supports dependency ordering, parallel ready
steps, tool and agent Activities, deterministic transform/condition steps,
wait timers, and approval Signals. Shared JSON Schema validation, runtime
scope propagation into every Activity, explicit retry policies, and the API
route for approval Signals are the next implementation boundaries.

The runtime must not connect directly to the TypeScript control-plane database
or expose a public HTTP API.

## Dependencies

- `go.temporal.io/sdk` — durable Workflows, Activities, Signals, retries, and
  Worker execution;
- `google.golang.org/adk/v2` — Google ADK Go 2.x agent and workflow runtime.
