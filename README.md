# Encois

Encois is an enterprise context-intelligence system. It connects scoped signals
from company systems, builds evidence-linked organizational context, and uses
bounded agents to explain what changed, why it matters, and what deserves
attention. Current version is read-oriented by default: observe, correlate,
explain, and recommend. Future versions would manage and do actions on behalf
of the user.

## Architecture

The dashed box is the hosted Google Cloud boundary. The local demo keeps the
same application topology with explicit mock adapters. Scope always starts
with the organization tenant and authorized organization-unit IDs; it is
calculated by API Gateway and rechecked by Runtime, Agent Gateway, and storage
adapters.

```mermaid
flowchart LR
    User([User])

    subgraph External[Company systems]
        Providers["GitHub · Jira · Google Workspace<br/>monitoring · MCP / API tools"]
    end

    subgraph TemporalCloud[Temporal Cloud or local Temporal]
        Coordinator["Coordinator Workflow<br/>one long-lived execution per organization"]
        Runs["Dynamic Blueprint Runs<br/>Source Ingestion Runs"]
    end

    subgraph GCP[Google Cloud deployment boundary]
        Identity["Identity Platform<br/>or local Auth emulator"]
        Edge[HTTPS load balancer / local ports]

        subgraph Services[Encois services · Cloud Run or local Compose]
            Dashboard[React Dashboard]
            API["TypeScript API Gateway<br/>public control plane"]
            Dispatcher["Coordinator outbox dispatcher<br/>inside API Gateway"]
            Runtime["Go Agent Runtime<br/>Temporal worker · Google ADK"]
            AgentGateway["Private Agent Gateway<br/>policy · tools · provider broker"]
            Scope["Scope envelope<br/>organization tenant + authorized unit IDs<br/>capability rechecked at every boundary"]
        end

        Postgres[("Cloud SQL PostgreSQL<br/>RLS · product state · Runs<br/>outbox · user projections")]
        Storage[("Cloud Storage<br/>raw Source artifacts")]
        Graph[("Organization Memory<br/>Spanner Graph<br/>structured facts + relationships")]
        Memory[("Workflow Memory<br/>Agent Platform Memory Bank<br/>agent-specific semantic context")]
        Gemini["Gemini on Vertex AI<br/>reasoning and synthesis"]
        Secrets["Secret Manager<br/>provider credentials"]
        Telemetry["Cloud Logging / Trace<br/>OpenTelemetry signals"]
    end

    User --> Edge
    User --> Identity
    Edge --> Dashboard
    Edge --> API
    Identity -->|verified identity token| Dashboard
    Dashboard -->|typed HTTPS API only| API

    API -->|membership + permissions| Scope
    API -->|transactional state + lifecycle event| Postgres
    Postgres -->|leased outbox rows| Dispatcher
    Dispatcher -->|versioned Signal| Coordinator
    Coordinator -->|approved start callback| API
    API -->|start · query · signal · cancel| Coordinator
    API -->|start · query · signal · cancel| Runs
    Runtime -. polls one task queue .-> Coordinator
    Runtime -. polls one task queue .-> Runs

    Scope -. signed execution scope .-> Runtime
    Scope -. signed capability + scope .-> AgentGateway
    Runtime -->|bounded tools and Source reads| AgentGateway
    Runtime -->|distill / retrieve| Memory
    Runtime -->|model calls| Gemini
    Runtime -->|private status and evidence callback| API
    API -->|read-only scoped Graph query| AgentGateway
    API -->|read-only scoped Memory query| Runtime

    Providers -->|verified webhooks| API
    AgentGateway -->|read-only provider calls| Providers
    AgentGateway -->|artifact read / write| Storage
    AgentGateway -->|scoped fact upsert / query| Graph
    AgentGateway -->|credential reference resolution| Secrets

    API --> Telemetry
    Runtime --> Telemetry
    AgentGateway --> Telemetry

    style GCP fill:#f8fbff,stroke:#4285f4,stroke-width:2px,stroke-dasharray:8 5
    style Services fill:#ffffff,stroke:#64748b,stroke-width:1px
    style TemporalCloud fill:#fff8f1,stroke:#f97316,stroke-width:1px
    style External fill:#f8fafc,stroke:#94a3b8,stroke-width:1px
```

The stores have deliberately different responsibilities:

- PostgreSQL is the control plane: identity links, scope, configuration,
  outbox, Runs, and user-facing projections.
- Organization Memory is structured company context in Spanner Graph.
- Workflow Memory is agent-specific semantic context in Agent Platform Memory
  Bank.
- Temporal owns durable execution history, retries, waits, Signals, and
  recovery; it is not an application database.
- Cloud Storage owns large raw Source artifacts; agents access it through the
  private Agent Gateway.

## Run locally

Requires Node.js `24.19.0`, pnpm `11`, and Docker Desktop. No Google Cloud
credentials are needed for the default mock stack.

```bash
pnpm install
pnpm run local
```

The command builds and starts PostgreSQL, Temporal, Firebase emulators, the
populated Sun Inc seed, API Gateway, Agent Gateway, Agent Runtime, and the
Dashboard.

| Surface              | Address                 |
| -------------------- | ----------------------- |
| Dashboard            | `http://localhost:5173` |
| API Gateway          | `http://localhost:8787` |
| Temporal UI          | `http://localhost:8233` |
| Firebase Emulator UI | `http://localhost:4000` |

Sign in with `owner@local.test` / `local-password-1234`. Stop the stack with:

```bash
pnpm run local:down
```

Real Gemini, Spanner Graph, and Memory Bank are opt-in; see
[`docs/demo.md`](docs/demo.md). Local operation and troubleshooting are in
[`docs/operations.md`](docs/operations.md).

## Repository

```text
apps/dashboard       React SPA
apps/api-gateway     TypeScript/Hono public control plane
apps/agent-runtime   Go Temporal worker and Google ADK agents
apps/agent-gateway   private Go policy and tool broker
packages/contracts   versioned TypeScript/Go boundaries
packages/database    PostgreSQL schema and migrations
infra                Google Cloud deployment configuration
docs                 architecture, operations, security, and product guides
```

Key documentation:

- [`docs/architecture.md`](docs/architecture.md) — system boundaries and
  complete lifecycle.
- [`docs/contracts.md`](docs/contracts.md) — public, Temporal, Coordinator, and
  private service contracts.
- [`docs/demo.md`](docs/demo.md) — local/hosted demos, AI seed, and user invite.
- [`docs/operations.md`](docs/operations.md) — local operation, GCP, and CI/CD.
- [`docs/security.md`](docs/security.md) — trust boundaries and tenant
  isolation.
- [`docs/dictionary.md`](docs/dictionary.md) — canonical product vocabulary.
- [`docs/documentation.md`](docs/documentation.md) — user-facing product guide.
- [`docs/scripts.md`](docs/scripts.md) — supported commands and ownership.

The deployable services target Cloud Run, with Cloud SQL, Identity Platform,
Cloud Storage, Spanner Graph, Vertex AI, Memory Bank, Secret Manager,
Cloud Logging/Trace, and Temporal Cloud. Deployment is opt-in and documented
in [`infra/`](infra/) and [`docs/operations.md`](docs/operations.md).

## License

This private proprietary repository is available only for authorized
evaluation. It is not licensed for copying, forking, redistribution, reuse,
derivative works, or commercial use. See [`LICENSE`](LICENSE).
