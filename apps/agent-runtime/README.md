# Encois Agent Runtime

The deployable Go worker application for Temporal Workflows, Activities, and
Google ADK agents. It is a Temporal Worker, not a public application API. It
exposes only internal liveness/readiness endpoints for Cloud Run.

## Run

Start the private Agent Gateway first, then a local Temporal server, and run:

```bash
AGENT_AI_MODE=mock AGENT_MEMORY_MODE=mock go run ./cmd/agent-runtime
```

Configuration is environment-based:

- `AGENT_RUNTIME_HTTP_ADDR` — internal health listener; defaults to `:8080` or
  the Cloud Run `PORT` value. Use `:8090` locally when the Agent Gateway uses
  its default `:8080`;
- `TEMPORAL_HOST_PORT` — defaults to `127.0.0.1:7233`;
- `TEMPORAL_NAMESPACE` — defaults to `default`;
- `TEMPORAL_TASK_QUEUE` — defaults to `encois-agent-runtime`;
- `TEMPORAL_API_KEY` — optional Temporal Cloud API key;
- `AGENT_AI_MODE` — `gemini` (default) uses the configured Gemini/Vertex AI
  backend; `mock` enables the deterministic local fixture in
  `internal/mock` and requires no model credentials;
- `AGENT_GATEWAY_URL` — defaults to `http://127.0.0.1:8080`;
- `AGENT_GATEWAY_SERVICE_TOKEN` — bearer token used for private Gateway calls;
- `AGENT_GATEWAY_AUDIENCE` — optional Cloud Run service URL; when set, the
  client sends a Google ID token for Cloud Run IAM and the Encois service token
  separately;
- `CONTROL_PLANE_URL` — optional private Gateway API URL used by Coordinator
  Activities to submit typed plans or start an approved Blueprint;
- `CONTROL_PLANE_SERVICE_TOKEN` — application-level token for the private
  control-plane route;
- `CONTROL_PLANE_AUDIENCE` — optional Cloud Run URL; when set, the client also
  sends a Google ID token for Cloud Run IAM;
- `GOOGLE_GENAI_USE_VERTEXAI` — set to `true` in Cloud Run to use Vertex AI with
  Application Default Credentials instead of a long-lived Gemini API key;
- `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` — Vertex AI project and
  region; the location defaults to `us-central1`;
- `GEMINI_API_KEY` or `GOOGLE_API_KEY` — optional for the local scaffold;
  without it ADK agent steps return a deferred status instead of calling
  Gemini. Use `AGENT_AI_MODE=mock` when the local workflow should produce a
  short deterministic AI result instead;
- `AGENT_MEMORY_MODE` — `gcp` (default) calls Vertex AI Memory Bank through the
  configured Reasoning Engine; use the explicit `mock` value for local/test
  runs;
- `AGENT_MEMORY_FIXTURE` — set to `local` with mock memory to enable the
  deterministic organization-scoped local fixture;
- `VERTEX_MEMORY_REASONING_ENGINE` — full Vertex AI Reasoning Engine resource
  name required by `AGENT_MEMORY_MODE=gcp`;
- `GEMINI_MODEL` — defaults to `gemini-3.7-flash`.
- `GEMINI_COORDINATOR_MODEL` — defaults to `gemini-3.1-pro-preview`; used by
  the Coordinator and Workflow Creator instead of the lower-latency specialist
  model;
- `GEMINI_COORDINATOR_THINKING_LEVEL` — defaults to `high`; supported values
  are `low`, `medium`, and `high`.

The current skeleton:

- connect to the configured Temporal endpoint (local Temporal Server or Temporal Cloud) and poll named task queues;
- initializes Coordinator and Workflow Creator ADK capabilities with a
  stronger reasoning profile when Gemini is configured; the generic Blueprint
  path invokes approved Agent Definitions from Activities, and the bootstrap
  path can propose a validated `workflow-change-plan.v1` when Gemini is
  available;
- keeps model calls and external I/O inside Activities;
- use versioned Temporal payloads and the private Agent Gateway boundary; and
- emit scoped, redacted runtime telemetry.

The current generic Blueprint path runs one approved ADK Agent Definition as a
Temporal Activity. Temporal therefore retries that Activity as one unit; the
internal ADK/model/tool turns are not yet separate Temporal Activities. This is
intentional for the first slice. Temporal's official Go `googleadk` contrib
integration is a future migration option for running the ADK loop in Workflow
code with model calls dispatched as `InvokeModel` Activities and I/O tools
dispatched through `ActivityAsTool` or an MCP proxy. The currently available
`go.temporal.io/sdk/contrib/googleadk@v0.2.0` is a separate module and requires
Temporal Go SDK `v1.45.0` plus an ADK revision containing Temporal's
determinism seams. It is not a dependency of this runtime yet. Validate it in
a focused spike before changing this runtime.

At startup the process creates the Temporal client, registers the Worker, and
only then marks `/health/ready` healthy. Trace IDs from the API, together with
Temporal Workflow run IDs, are attached to Activity inputs and private tool
requests for correlation. These IDs are observability metadata, not
authorization inputs. A fatal Worker error marks the process unready and exits
so Cloud Run can replace the revision.

Registered workflows:

- `encois.user-blueprint.v1` — generic workflow that interprets a validated
  company-specific Blueprint and executes typed tool/agent steps;
- `CoordinatorWorkflow` — long-lived organization/project onboarding and
  reconciliation loop; uses Signals, timers, and Continue-As-New;
- `BootstrapProjectWorkflow` — short initial bootstrap phase.
- `encois.source-ingestion.v1` — platform-owned source/revision ingestion
  coordinator. It is distinct from user Blueprints and runs the shared
  acquire → parse → facts/provenance → Graph → Memory pipeline. Local mode
  uses deterministic source fixtures; hosted mode reads artifacts through the
  Agent Gateway and writes to the configured GCP adapters.

The Coordinator and Workflow Creator prompts are present in the ADK bundle. The
bootstrap Workflow calls a `CreateBootstrapPlan` Activity, which discards raw
model output and returns only a canonical, deterministically validated
`workflow-change-plan.v1`. The long-lived `CoordinatorWorkflow` now calls
`CreateCoordinatorPlan` and `SubmitWorkflowChangePlan` after a reconciliation
signal or timer. These Activities only propose and submit a typed plan; they do
not approve it or persist it directly. After Gateway approval/application, the
Coordinator receives a deduplicated `coordinator-event.v1`; only explicit
change-level `start` intents become `workflowStarts`, which are started through
the private Gateway Activity. Intermediate thoughts are not emitted to users or
logs; only the validated result is retained.

Tool Activities call the Agent Gateway over HTTP. The gateway currently
exposes two in-memory, read-only fixtures: 10 Jira tasks with 8 completed,
plus mock GitHub pull-request/check data. Agent steps currently run ADK
reasoning over their validated input and prior step results; provider tools
are invoked by explicit `tool` steps.

Knowledge Source ingestion uses the same private data-plane boundary after a
Source and immutable Revision are registered by the Gateway API. The Workflow
input carries only source/revision IDs, scope, trigger, and artifact/provider
references; raw bytes and credentials never enter Temporal history. The
current MVP pipeline performs acquisition, text normalization, deterministic
fact extraction, provenance, Graph projection, and Memory distillation. OCR,
transcription, and live provider adapters remain provider-specific follow-up
work.

The generic interpreter currently supports dependency ordering, parallel ready
steps, tool and agent Activities, deterministic transform/condition steps,
wait timers, and approval Signals. It validates the workflow contract and
Blueprint semantics before execution, propagates scope and run IDs into every
Activity, deduplicates approval Signals by `signalId`, and applies bounded
Activity retries. Shared canonical JSON Schema validation now runs in the
TypeScript API, Runtime contract Activities, and Agent Gateway tool boundary;
the `tool-manifest.v1` catalog schema is also shared. The generic
`blueprint-context` Update is now registered and exercised locally; broader
Update types, hosted migration/concurrency verification, and the visibility
integration remain deferred boundaries. Signal/Update command receipts are
implemented in the Gateway persistence boundary.

Agent-specific Memory Bank access has a separate typed boundary in
`internal/memory`. It supports scoped `retrieve` and evidence-linked
`distill` requests, validates the canonical contracts, and is registered as the
`ExecuteAgentMemory` Activity. `AGENT_MEMORY_MODE=mock` is enabled explicitly
by the local Compose configuration; `gcp` uses the official Vertex AI Memory
Bank REST client. Memory operations are
not Workflow state and are never a substitute for the company Graph or
control-plane Postgres.

The runtime must not connect directly to the TypeScript control-plane database
or expose a public HTTP API. `GET /health/live` and `GET /health/ready` exist
only for service health checks.

## Dependencies

- `go.temporal.io/sdk` — durable Workflows, Activities, Signals, retries, and
  Worker execution;
- `google.golang.org/adk/v2` — Google ADK Go 2.x agent and workflow runtime.

The native Temporal/ADK integration is intentionally not listed as a runtime
dependency yet. Its own `v0.2.0` package tests pass independently, but adopting
it would change the execution granularity and dependency set of this Worker.
