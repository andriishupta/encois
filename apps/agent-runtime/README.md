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
- `GEMINI_API_KEY` or `GOOGLE_API_KEY` — optional; without it synthesis uses
  the deterministic fixture result;
- `GEMINI_MODEL` — defaults to `gemini-3.7-flash`.
- `GEMINI_COORDINATOR_MODEL` — defaults to `gemini-3.1-pro-preview`; used by
  the Coordinator and Workflow Creator instead of the lower-latency specialist
  model;
- `GEMINI_COORDINATOR_THINKING_LEVEL` — defaults to `high`; supported values
  are `low`, `medium`, and `high`.

The current skeleton:

- connect to Temporal Cloud and poll named task queues;
- hosts a coordinator and Jira/GitHub specialist ADK agents when Gemini is
  configured;
- keeps model calls and external I/O inside Activities;
- use versioned Temporal payloads and the private Agent Gateway boundary; and
- emit scoped, redacted runtime telemetry.

Registered workflows:

- `ReleaseRiskWorkflow` — parent workflow that fans out to Jira and GitHub
  child workflows, then synthesizes an evidence-linked insight;
- `JiraReleaseWorkflow` — Jira specialist boundary;
- `GitHubReleaseWorkflow` — GitHub specialist boundary.
- `CoordinatorWorkflow` — long-lived organization/project onboarding and
  reconciliation loop; uses Signals, timers, and Continue-As-New;
- `BootstrapProjectWorkflow` — short initial bootstrap phase.
- `encois.user-blueprint.v1` — generic dynamic workflow registration for
  validated user-created step graphs. Steps are data and execute through
  Activities; no Go code is generated at runtime.

The Coordinator's `WorkflowCreator` emits typed plans only for workflow types
already registered by the Worker. The Gateway API owns blueprint persistence,
authorization, and Temporal Schedule API operations.

Coordinator and Workflow Creator responses use the stronger model plus the
highest supported Gemini thinking level. Intermediate thoughts are not emitted
to users or logs; only the validated result is retained.

Jira and GitHub Activities call the Agent Gateway over HTTP. The gateway's
current tools are in-memory fixtures: 10 Jira tasks with 8 completed, plus
mock GitHub pull-request/check data.

The runtime must not connect directly to the TypeScript control-plane database
or expose a public HTTP API.

## Dependencies

- `go.temporal.io/sdk` — durable Workflows, Activities, Signals, retries, and
  Worker execution;
- `google.golang.org/adk/v2` — Google ADK Go 2.x agent and workflow runtime.
