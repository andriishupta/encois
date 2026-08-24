# AGENTS.md

## Purpose and scope

This repository is a pnpm workspace with a TypeScript Gateway API/UI and a Go agent runtime for Encois, an enterprise context-intelligence system. Encois correlates signals from company systems, uses specialized agents to investigate them, and presents evidence-backed insights to people. The MVP is read-oriented: observe, correlate, explain, and recommend. Any action that changes external systems requires an explicit approval boundary.

This file is the working guide for contributors and coding agents. The source of truth for product intent, the first architecture baseline, and the competition constraints is:

- [`docs/idea.md`](docs/idea.md) — product vision, users, MVP, and positioning.
- [`docs/architecture.md`](docs/architecture.md) — proposed system boundaries, runtime, state, and deployment.
- [`docs/flows.md`](docs/flows.md) — proposed product and runtime flows.
- [`docs/contracts.md`](docs/contracts.md) — OpenAPI/JSON Schema boundaries and cross-language type generation.
- [`docs/protocols.md`](docs/protocols.md) — generic Workflow Blueprint, MCP-shaped tools, ADK, and Temporal communication model.
- [`docs/security.md`](docs/security.md) — repository-wide security baseline, trust boundaries, and security invariants.
- [`docs/dictionary.md`](docs/dictionary.md) — canonical architecture and runtime vocabulary.
- [`docs/system-diagram.md`](docs/system-diagram.md) — living current-state service and execution diagram.
- [`docs/hackaton.md`](docs/hackaton.md) — the local digest of the All Things Agentic hackathon requirements.

Do not invent product requirements that conflict with those documents. If implementation reveals a meaningful architectural decision, update the relevant document or add a decision record rather than hiding the decision in code. The architecture documents are a baseline and should evolve with the first working vertical slice.

## Working principles

1. Ship one demonstrable vertical slice before building platform abstractions.
2. Keep boundaries explicit so integrations, agents, storage, and UI can evolve independently.
3. Prefer boring, typed, observable code over clever abstractions.
4. Treat external data, model output, webhooks, and MCP tool results as untrusted input.
5. Make read-only behavior the default. Never add autonomous write actions without an approval, authorization, audit, and rollback story.
6. Use TODOs for deliberately deferred production work. Every TODO should state the missing behavior or decision, not merely say “improve this”.
7. Optimize for the hackathon demo without creating avoidable security or operational debt.
8. Run tests only when the user explicitly requests testing/verification or the task itself requires it - unit or tools like tsx/go are fine for harder things and multi-step implementations, but e2e should be definetly run only once; e2e is not mandatory on every run.
9. No need to add tests everywhere ad this point - only some crucial parts can be covered on api/agent code
10. If during goal persue you notice some unrelated issues or gaps - report them but don't start to implement them or dont count them as part of goal - it is ok to stop, when not sure

## Product truth and mocking policy

Product state must always come from the real contract and the real system of
record. Never fabricate, infer, or persist a fake product state just to make a
screen or API appear complete. This applies to the dashboard, Gateway API,
agent runtime, persistence, contracts, seed data, and shared UI components.

- Do not replace missing or incomplete backend data with a fake `ready`,
  `pending`, `completed`, `active`, `healthy`, onboarding, workflow, Run,
  integration, permission, user, or organization state.
- Do not invent IDs, records, status transitions, counts, timestamps, evidence,
  permissions, or successful API responses in browser code or API fallbacks.
- If the API does not return a status, field, record, or capability, preserve
  that fact. Show a truthful loading, empty, unavailable, unknown, or error
  state, and report the contract/backend gap. Do not add a UI hack that makes
  the unsupported behavior look implemented.
- If the API returns a status set that differs from the UI contract, stop at the
  boundary: validate and surface the mismatch, then fix the API/contract and UI
  together. Do not silently map an unknown status to a successful or convenient
  status.
- A mock is allowed only at an explicit third-party or infrastructure adapter
  boundary when the real dependency is unavailable in the target environment.
  Examples include Memory Bank, Spanner Graph, Vertex AI, provider APIs, or
  other external services. The mock must be explicitly configured, use the same
  contract and failure semantics, remain scoped to that adapter, and never
  spread mock decisions through product logic.
- Mocks are acceptable in isolated tests and deterministic fixtures. Runtime
  mock mode must be visible in configuration and must not be the production
  source of truth. A third-party adapter mock must not fabricate control-plane
  onboarding, organization, authorization, workflow, or Run state.
- When a required dependency or contract is missing, block or narrow the
  affected capability and tell the user what is unavailable. Do not create a
  parallel local state machine to hide the problem.

## Iterative collaboration and approval boundary

- Work iteratively with the user: inspect, propose, and implement the requested small safe change. Verify only the behavior and artifacts explicitly included in the task; do not expand validation into unrelated surfaces.
- Do not delete, reset, migrate destructively, rotate credentials, or make other critical externally visible changes without explicit user approval.
- If a change is blocked, risky, or materially ambiguous, stop at the boundary, report the evidence and the risk, and ask for direction instead of silently changing the plan.
- If a goal reaches a critical blocker that cannot be resolved safely from the available workspace or permissions, stop that goal explicitly, report the blocker and the evidence, and ask the user what access or decision is needed. Do not force completion by weakening security or inventing missing state.
- Treat the user and the coding agent as partners: challenge assumptions when evidence disagrees, preserve unrelated work, and keep decisions reviewable.

## Verification scope

- Do not run tests, builds, browser checks, UI flows, screenshots, smoke tests, end-to-end tests, or unrelated validation unless the user explicitly asks for testing/verification or the task explicitly requires that check.
- Verify only what the user requested. A database change does not authorize checking the UI; a UI change does not authorize checking the API, database, or unrelated routes.
- If the user asks to test, test only the requested scope and do not add broad exploratory checks unless the user asks for them.
- Higher-priority safety or environment checks that are required to execute the requested change may still be performed, but must remain narrowly scoped and be reported.

## Hackathon constraints

The project must remain eligible for the All Things Agentic hackathon. The current requirements are summarized in [`docs/hackaton.md`](docs/hackaton.md); the official rules remain authoritative if they change.

The implementation must visibly use:

- Gemini 3.5 or newer through the Gemini API or Vertex AI.
- At least one Google agent framework: Google ADK, GenAI SDK, Antigravity SDK, or Genkit.
- At least one Google Cloud infrastructure service, such as Cloud Run, Cloud SQL, Firestore, GKE, or Pub/Sub.

The demo must show an autonomous behavior beyond a plain chat loop: background/asynchronous work, a multi-step workflow, meaningful data transformation, or delegation between agents. The repository must be reproducible, and the final submission needs a hosted project when available, a clear README, an architecture diagram, and an English demonstration video no longer than four minutes that proves the backend runs on Google Cloud.

For Encois, the most natural category is Fortified Enterprise Fleet. The MVP should demonstrate a small but real version of an agent registry, delegated specialist agents, persistent investigation state, scoped identity, policy checks, and OpenTelemetry-compatible traces. Do not implement every enterprise feature before the core demo works; record deferred pieces as TODOs.

## Expected monorepo shape

Use this layout as the repository grows. Empty directories do not need to be created in advance.

```text
apps/
  dashboard/           React SPA
  api-gateway/         Hono HTTP API and webhook ingress
  agent-runtime/       Go Temporal workers and Google ADK agents
  agent-gateway/       private Go policy/tool broker; may start in-process with agent-runtime
packages/
  domain/              business concepts, ports, and validation
  contracts/           shared API/event schemas and generated types
  agent-core/          agent orchestration, policies, and structured outputs
  integrations/        GitHub, Jira, Google Workspace, monitoring, and Stripe adapters
  persistence/         repositories and database implementations
  observability/       logging, tracing, metrics, and redaction helpers
  config/              typed runtime configuration and environment parsing
  ui/                  reusable presentational components, if genuinely shared
tooling/
  eslint-config/
  tsconfig/
infra/                 Google Cloud deployment and infrastructure definitions
docs/                  product, hackathon, and later architecture decisions
```

The exact names may change, but dependency direction should remain close to:

```text
dashboard -> api-gateway -> domain/contracts
api-gateway -> Temporal workflows and domain/contracts
agent-runtime -> Temporal workflows, Google ADK, versioned contracts, private agent-gateway
agent-gateway -> integrations, policy, Secret Manager, and versioned contracts
api-gateway -> control-plane persistence, integrations, observability
integrations/persistence -> domain ports
```

Domain packages must not import Hono, React, Google Cloud SDKs, database clients, or vendor-specific integration code. Adapters implement domain-defined ports. Keep provider-specific payloads at the adapter boundary and map them into small internal models. Cross-language API, workflow, and private Agent Gateway payloads must use versioned OpenAPI/JSON Schema contracts. Do not share TypeScript source files with Go.

If the control plane uses Postgres and Drizzle, the TypeScript API owns its schema and migrations. The Go Runtime and Agent Gateway do not connect to the control-plane database: Runtime Activities use Temporal payloads, the private Agent Gateway, and the Memory Bank adapter; the Agent Gateway owns Cloud Storage and Spanner Graph access.

Use scoped package names such as `@encois/domain` and `@encois/contracts`. Keep package APIs intentional: export stable entry points, avoid deep imports, and do not expose database or SDK types to every consumer.

## pnpm and TypeScript conventions

- Prefer a functional style in TypeScript application code: use modules and
  functions for services, handlers, factories, and state transitions. Avoid
  application-defined classes unless an external SDK or framework requires a
  class; keep such SDK classes hidden behind a small functional adapter.
- Keep shared resources such as the API runtime database in a dedicated module
  and import them where needed. Do not pass the database through service
  constructors or route factories.
- Keep one root `pnpm-lock.yaml` and one workspace definition. Do not use npm or yarn lockfiles.
- Prefer `workspace:*` for internal dependencies.
- Pin or constrain tool versions consistently; document upgrades in the root changelog or a decision record when they affect runtime behavior.
- Add a root `packageManager` declaration and a Node version policy before the first deploy. Until then, use a current LTS Node release compatible with pnpm 11.
- Every package should have `build`, `typecheck`, `lint`, and `test` scripts where the package type makes them meaningful.
- Root scripts should fan out through pnpm filters or a task runner only after parallel execution and caching are useful. Avoid introducing a task runner solely for a few packages.
- Use strict TypeScript. Avoid `any`; if an external boundary is unknown, validate it and narrow it to an explicit type.
- Prefer `unknown` at I/O boundaries, discriminated unions for state, and schema validation for JSON.
- Keep compiler options consistent through shared base configs. A package may be stricter, but should not silently weaken the root policy.
- Name Drizzle migrations with stable, descriptive kebab-case names through `pnpm --filter @encois/persistence db:generate -- <name>`; do not keep generated random names. Keep the migration journal and snapshot files sequential with the SQL files.
- Do not commit generated files, build output, `.env` files, credentials, service-account keys, or local database files unless explicitly required and documented.

Useful commands once the workspace packages exist:

```bash
pnpm install
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm --filter @encois/dashboard dev
pnpm --filter @encois/api-gateway dev
(cd apps/agent-gateway && AGENT_GATEWAY_DATA_MODE=mock go run .)
(cd apps/agent-runtime && AGENT_AI_MODE=mock AGENT_MEMORY_MODE=mock go run .)
```

Prefer the narrowest filter while iterating, then run the full checks before handoff.

## Application boundaries

### React web

- Use a React SPA for the authenticated product UI.
- Use client-side routing and typed API/query layers for dashboard, canvas, chat, and live workflow state.
- Use the local shadcn-style primitives in `apps/dashboard/src/components/ui` for shared UI. Card surfaces must use `Card`; interactive card-like choices must use the shared card primitive rather than page-local `<button>` card markup. Keep the default shadow, radius, border, spacing, focus, hover, and disabled states consistent. Disabled cards must not expose hover highlighting.
- Keep credentials and provider SDKs out of browser bundles. Browser code calls the API through typed contracts.
- Handle loading, empty, error, and stale-data states for every intelligence view.
- Make evidence and freshness visible in the UI. A model conclusion without sources, timestamps, and scope is not a trustworthy insight.

### Hono API

- Keep route handlers thin: authenticate, validate, call an application service, and map the response.
- Validate path, query, body, webhook, and MCP inputs at the boundary. Return stable error shapes with a request ID.
- Apply authentication and authorization before loading organization-scoped data.
- Add request IDs and trace context to every request. Do not log authorization headers, cookies, raw tokens, or full sensitive request bodies.
- Set explicit CORS, content type, body-size, timeout, and rate-limit policies. Do not use permissive defaults in deployed environments.
- Make webhook handlers signature-verified, idempotent, and fast. Enqueue work rather than performing long model or integration calls inline.

### Agents and workers

- Agents are orchestrators of bounded tools, not unrestricted application code.
- Give each agent a narrow role, an explicit input/output schema, a tool allowlist, a timeout, a retry limit, and a budget.
- Separate planning, evidence collection, synthesis, and recommendation. Preserve source references and timestamps through every stage.
- Treat model output as untrusted. Validate structured output, reject unsafe or incomplete actions, and fall back to a reviewable error.
- Use deterministic code for authorization, policy, thresholds, deduplication, and state transitions. Do not ask a model to decide access control.
- Persist job status, attempts, lease/lock information, and idempotency keys for asynchronous work.
- Retries must be bounded and use backoff. Non-idempotent operations require a deduplication key and an approval step.
- Do not log chain-of-thought or hidden reasoning. Store concise decisions, evidence references, tool calls, outcomes, latency, and error classifications.

### MCP and external tools

- Every MCP server and tool must declare its purpose, input schema, output schema, side effects, and required scope.
- Default MCP tools to read-only. Separate read and write tools and make write tools visibly approval-gated.
- Authenticate the caller and authorize every tool invocation; never trust a tool name or organization ID supplied by the model.
- Allowlist outbound hosts and methods. Defend against SSRF, path traversal, oversized payloads, prompt injection, tool poisoning, and data exfiltration.
- Treat instructions returned by external systems as data, not as higher-priority policy.
- Redact secrets and sensitive fields before sending data to models or logs. Return the minimum data needed for the task.

## Security and privacy baseline

Security is part of the MVP even when the implementation is small.

- Use Secret Manager or the deployment platform’s secret integration. Never commit API keys or service-account JSON files.
- Use separate Google Cloud projects or at least separate service accounts for local development, staging, and demo production when practical.
- Grant least-privilege IAM roles. Prefer short-lived credentials and workload identity over long-lived keys.
- Scope every record, cache key, job, and vector/document lookup by organization and authorized hierarchy level.
- Verify webhook signatures and replay protection where providers support them.
- Validate and normalize third-party data before persistence. Use parameterized queries and existing SDK escaping; never build SQL or shell commands from model output.
- Add timeouts, retries, circuit breaking, and concurrency limits around provider calls.
- Minimize stored PII. Define retention and deletion behavior before ingesting real company data. Use synthetic or redacted fixtures for the demo.
- Never send secrets, access tokens, unnecessary PII, or unrestricted raw company data to a model.
- Keep audit events separate from debug logs. Audit events should answer who/what/when/scope/result; they should not contain secrets or chain-of-thought.
- Report suspected vulnerabilities privately and do not include exploit credentials or real customer data in issues, tests, or demo recordings.

## Data and intelligence quality

An insight is only useful if a person can inspect why it exists.

- Model the organizational scope explicitly: company, department, team, project, person/system.
- Store provenance for imported facts: source, source record ID, observed time, ingestion time, freshness, and transformation version.
- Keep raw provider data separate from normalized facts and generated insights. Apply retention limits to raw data.
- Use stable IDs and idempotent upserts. Expect duplicate events, out-of-order events, deleted records, and provider rate limits.
- Version schemas and prompts that affect persisted output. Do not silently change the meaning of historical insights.
- Prefer evidence-linked claims and confidence labels over unsupported certainty. Clearly distinguish observed facts, model inference, and recommendation.
- Keep a small synthetic dataset that covers a release risk, a blocker, a deployment regression, and permission boundaries.

## Observability

The hackathon requires agent observability, and the product depends on explainability. Use OpenTelemetry-compatible traces where the selected Google Cloud services support them.

- Propagate a correlation ID, trace ID, organization scope, actor, job ID, and agent run ID across web, API, queue, integration, and model calls.
- Emit structured JSON logs with stable event names and severity. Include duration, status, retry count, provider, model, and error class.
- Instrument the agent lifecycle: trigger, planning, delegation, tool call, evidence read, synthesis, persistence, and user-visible result.
- Track useful metrics: request latency, queue age, job success/failure, model latency, token/cost estimates, provider errors, rate-limit responses, and stale-data counts.
- Use dashboards or saved queries for the demo that make one end-to-end investigation easy to follow.
- Redact before export. Never capture full prompts, raw documents, tokens, cookies, or sensitive response bodies by default.
- Add a health endpoint for liveness and a separate readiness check for dependencies. Health checks must not invoke a model or mutate data.

## Testing and evaluation

Tests should protect boundaries and the demo path, not create ceremony.

- Unit-test domain rules, authorization, state transitions, parsers, redaction, retry decisions, and evidence ranking.
- Contract-test each integration with recorded, sanitized fixtures. Do not make ordinary tests depend on live GitHub, Jira, Google, Stripe, or model APIs.
- Add API tests for auth failures, invalid payloads, tenant isolation, rate limits, idempotency, and stable error responses.
- Add agent evaluations with fixed scenarios and expected evidence requirements. Test refusal, missing data, contradictory data, prompt injection, and tool failure.
- Add one end-to-end smoke test for the demo scenario using fake or synthetic integrations where possible.
- Run typecheck, lint, tests, or a production build only when explicitly requested or when the task explicitly requires that check; do not run them as a general completion checklist.
- If a check cannot be added during the hackathon, leave a TODO with the risk and the intended test boundary.

## Google Cloud and deployment

Start with the smallest deployment that proves the product. The current MVP shape is Cloud Run for the Gateway API, a private Agent Gateway on internal Cloud Run (or in-process for the first slice), Temporal Cloud for durable execution, a Go Temporal/ADK agent runtime, Vertex AI Memory Bank for scoped agent memory, Spanner Graph for company context, and Cloud Storage for large artifacts. Do not build a custom Firestore workflow engine.

- Keep deployment configuration in `infra/` and make environments explicit.
- Use immutable builds, lockfile-based installs, health checks, bounded concurrency, and explicit CPU/memory/timeouts.
- Configure logs, traces, alerts for failures, and a documented rollback path before the demo.
- Use staging or a demo project with synthetic data. Never point a hackathon build at production systems without written authorization.
- Keep cloud spend bounded with quotas, short retention, scale-to-zero where appropriate, and a cleanup checklist.
- Record the deployed service, project, region, revision, database, queue, and model configuration so the demo can prove the backend is on Google Cloud.
- Do not make deployment depend on a developer laptop’s local credentials.

## Git and change hygiene

- Keep commits small and explain the user-visible or architectural intent.
- Do not mix broad formatting changes with behavior changes.
- Preserve unrelated working-tree changes.
- Update docs and examples when commands, environment variables, API contracts, or deployment steps change.
- Never put real tokens, private URLs, customer identifiers, or unredacted screenshots in commits or demo assets.

## Definition of done for a hackathon slice

A vertical slice is ready when it:

- solves one clear Encois scenario end to end;
- uses the required Gemini, Google agent framework, and Google Cloud components;
- has typed and validated boundaries;
- preserves evidence, scope, timestamps, and an audit-friendly run record;
- has bounded failure behavior and a useful user-facing error;
- emits enough traces/logs to show what happened without leaking sensitive data;
- has a repeatable local start path and a demonstrated cloud deployment path;
- includes tests for the highest-risk boundaries; and
- leaves explicit TODOs for important deferred production work.

Before submission, also verify the checklist in [`docs/hackaton.md`](docs/hackaton.md), including the architecture diagram, README spin-up instructions, and the time-limited English demo video.

## Known deferred work

These are intentionally not prerequisites for the first MVP, but should become tracked work as the product grows:

- TODO: add a formal architecture decision record process and record decisions that materially change `docs/architecture.md`.
- TODO: complete production authorization semantics for explicit grants/restrictions and hierarchy administration.
- TODO: validate the hosted Temporal profile, Memory Bank/Spanner IAM, schema, and cost model in a real GCP project.
- TODO: integrate Model Armor or an equivalent policy layer if required by the final Fortified Enterprise Fleet design.
- TODO: define retention, deletion, export, and customer-data residency policies.
- TODO: add CI with dependency scanning, secret scanning, SBOM generation, tests, and deploy previews.
- TODO: add load, cost, prompt-injection, tool-poisoning, and disaster-recovery tests.
