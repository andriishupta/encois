# Encois System Diagram

**Status:** living current-state map  
**Last reviewed:** 2026-08-21
**Purpose:** keep one diagram that shows the current system shape, deployable boundaries, and the parts that are still scaffold or deferred.

This document is the visual map of the repository. It should be updated when a service boundary, runtime responsibility, data store, or deployment path changes. Detailed behavioral scenarios belong in [`flows.md`](flows.md); component decisions belong in [`architecture.md`](architecture.md).

## Legend

- Green: implemented boundary or working local path.
- Yellow: implemented boundary with a mock, deferred adapter, or incomplete hosted enforcement.
- Blue: target capability with no current repository boundary.
- Gray: external system or managed platform.
- Dashed arrows: optional, future, or not yet connected in the current vertical slice.

## Current system overview

```mermaid
flowchart TB
    Human[Human users]
    MCP[Future MCP clients]
    Edge[HTTPS edge / Load Balancer\nTarget GCP deployment]

    subgraph Public[Public application plane]
        Web[React SPA\napps/dashboard\nTanStack Router + Query\nCurrent: typed API queries and polling]
        API[Gateway API\napps/api-gateway\nHono + TypeScript\nAuth, scope, registry, workflow control]
        CoordinatorRoutes[Private Coordinator control routes\nservice token + organization scope\nCurrent: plan submit + approved-start boundary]
        Outbox[(Coordinator event outbox\nPostgres + RLS\nCurrent: transactional enqueue)]
        Dispatcher[Coordinator dispatcher\none-shot API image entrypoint\nCurrent: lease/retry + Temporal sink]
        Auth[Identity Platform\nGoogle-only browser sign-in\nGateway ID-token verification]
        SQL[(Cloud SQL PostgreSQL\nDrizzle + RLS\nUsers, memberships, invites, waitlist)]
    end

    subgraph Durable[Durable execution plane]
        Temporal[Temporal Cloud\nCurrent: client integration + passing local smoke\nTarget: hosted execution history, retries, Signals, timers]
        Runtime[Go Agent Runtime\napps/agent-runtime\nTemporal worker + Google ADK\nCurrent: generic workflow, ADK-in-Activity, health, fixtures]
    end

    subgraph Private[Private agent plane]
        AgentGateway[Agent Gateway\napps/agent-gateway\nGin policy and tool broker\nCurrent: service token, Cloud Run audience support, mock tools]
        Policy[Deterministic policy\nscope, capability, approval\nCurrent: inherited scope helper + read-only fixture policy]
        Integrations[Integration adapters\nJira, GitHub, Workspace, monitoring\nCurrent: synthetic fixtures]
    end

    subgraph Knowledge[Knowledge and evidence plane]
        Gemini[Vertex AI / Gemini\nADK model calls and synthesis]
        Memory[Agent-specific Memory Bank\nTyped Runtime Activity + redaction boundary\nCurrent: deferred store; target: hosted memory]
        Graph[(Spanner Graph\nTyped query boundary\nCurrent: deferred store; target: normalized facts)]
        Storage[(Cloud Storage\nTyped artifact + retention boundary\nCurrent: in-memory refs; target: raw artifacts)]
    end

    Sources[GitHub / Jira / Google Workspace / monitoring\nExternal systems]
    Ops[Cloud Logging / Trace / Metrics\nCurrent: partial instrumentation]

    Human --> Edge
    MCP -. future .-> Edge
    Edge --> Web
    Edge --> API
    Web --> API
    Runtime -. private control-plane calls .-> CoordinatorRoutes
    API --> Outbox
    Dispatcher --> Outbox
    Dispatcher --> Temporal
    API --> Auth
    API --> SQL
    API --> Temporal
    Temporal -. polls task queues .-> Runtime
    Runtime --> AgentGateway
    AgentGateway --> Policy
    AgentGateway --> Integrations
    Integrations --> Sources
    Runtime --> Gemini
    Runtime -. typed memory Activity\nprovider deferred .-> Memory
    AgentGateway -. typed graph query\nprovider deferred .-> Graph
    AgentGateway -. typed artifact refs\nprovider deferred .-> Storage
    API -.-> Ops
    Temporal -.-> Ops
    Runtime -.-> Ops
    AgentGateway -.-> Ops

    classDef live fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef scaffold fill:#fef3c7,stroke:#b45309,color:#78350f
    classDef target fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef external fill:#e5e7eb,stroke:#6b7280,color:#1f2937

    class Web,API,CoordinatorRoutes,Outbox,Dispatcher,SQL,Runtime,Gemini live
    class Auth,Temporal,AgentGateway,Policy,Integrations,Ops scaffold
    class Memory,Graph,Storage scaffold
    class Human,MCP,Edge,Sources external
```

The diagram intentionally shows the architecture and the implementation status together. The current local proof path uses the real TypeScript Temporal client, a local Temporal server, the Go Worker, the Agent Gateway, and synthetic provider fixtures; the API-only development path can still use the in-memory adapter. The target path keeps the same boundaries but replaces local services and fixtures with hosted authenticated services and managed Google Cloud resources.

Human access is invite-only in the current slice: Google/Identity Platform
provides the external identity, the Gateway matches a verified email to a
pending invite and provisions local membership, and unknown identities can
only submit the waitlist form. Identity Platform accounts and Encois users are
separate records; the local `users` row is the authorization projection.

All data-plane arrows are expected to carry organization scope, provenance, and
freshness. Memory writes additionally pass the deterministic `regex-v1`
redaction boundary. Temporal Namespace is shown as an execution platform
setting, not as a substitute for Gateway authorization.

## Deployable service boundaries

```mermaid
flowchart LR
    subgraph DashboardService[Cloud Run: Dashboard]
        Dashboard[Static React SPA\nNo provider credentials\nCalls only Gateway API]
    end

    subgraph ApiService[Cloud Run: Gateway API]
        Routes[Hono routes]
        RuntimeControl[Private Coordinator routes\nService token + organization scope]
        Middleware[Request ID, auth, validation, rate limits]
        Control[Control-plane services\norganizations, permissions, registry, workflows]
        TemporalClient[Temporal TypeScript client]
        Persistence[Drizzle repositories]
    end

    subgraph TemporalService[Temporal Cloud]
        TaskQueue[Task queues]
        History[Workflow history\nTimers, retries, Signals]
    end

    subgraph RuntimeService[Cloud Run or worker host: Go Agent Runtime]
        Worker[Temporal Go worker]
        Workflows[Workflow definitions\nCoordinator + generic Blueprint\nRelease readiness is an example]
        Activities[Activities\nprovider calls, synthesis, persistence references]
        ADK[Google ADK agents\nplanner, specialists, synthesizer\nCurrent: Activity boundary\nCandidate: googleadk v0.2.0 spike]
        RuntimeClient[Private Agent Gateway client]
    end

    subgraph GatewayService[Internal Cloud Run: Agent Gateway]
        GatewayHTTP[Gin HTTP server]
        GatewayAuth[Service identity + execution context]
        GatewayPolicy[Deterministic policy engine]
        ToolRegistry[Tool registry and allowlists]
        ProviderAdapters[Integration adapters]
    end

    SQL[(PostgreSQL)]
    Google[Vertex AI / Gemini]
    Provider[External provider APIs / MCP]
    Evidence[(Cloud Storage\nCurrent: in-memory ArtifactStore)]
    CompanyGraph[(Spanner Graph\nCurrent: deferred GraphStore)]
        AgentMemory[(Memory Bank\nCurrent: deferred store + active redaction boundary)]

    Dashboard --> Routes
    RuntimeClient -. private control plane .-> RuntimeControl
    RuntimeControl --> Middleware
    Routes --> Middleware --> Control
    Control --> Persistence --> SQL
    Control --> TemporalClient --> TaskQueue
    TaskQueue --> Worker
    History --> TemporalClient
    Worker --> Workflows --> Activities
    Activities --> ADK
    Activities --> RuntimeClient --> GatewayHTTP
    GatewayHTTP --> GatewayAuth --> GatewayPolicy --> ToolRegistry --> ProviderAdapters
    ProviderAdapters --> Provider
    ADK --> Google
    Activities -. typed artifact refs\nprovider deferred .-> Evidence
    RuntimeClient -. typed graph query\nprovider deferred .-> CompanyGraph
    ADK -. typed memory Activity\nprovider deferred .-> AgentMemory

    classDef live fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef scaffold fill:#fef3c7,stroke:#b45309,color:#78350f
    classDef target fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef external fill:#e5e7eb,stroke:#6b7280,color:#1f2937

    class Dashboard,Routes,RuntimeControl,Middleware,Control,TemporalClient,Persistence,Worker,Workflows,Activities,ADK live
    class GatewayHTTP,GatewayAuth,GatewayPolicy,ToolRegistry,ProviderAdapters scaffold
    class Evidence,CompanyGraph,AgentMemory scaffold
    class SQL,Google,Provider external
```

The Go Runtime is a worker application, not a public API and not a collection of one server per agent. Workflows and Activities are registered in the worker process. A Jira specialist or GitHub specialist is a logical agent/integration capability inside that runtime and Agent Gateway boundary, not automatically a separate microservice.

## Release investigation execution flow

```mermaid
sequenceDiagram
    actor User
    participant UI as React SPA
    participant API as Gateway API
    participant DB as PostgreSQL
    participant TC as Temporal Cloud
    participant RT as Go Agent Runtime
    participant AG as Private Agent Gateway
    participant Jira as Jira adapter
    participant GitHub as GitHub adapter
    participant Data as Evidence / Graph / Memory

    User->>UI: Start a company Blueprint execution
    UI->>API: POST generic workflow start request
    API->>API: Authenticate, resolve scope, validate Blueprint and input
    API->>DB: Check active run and idempotency key
    API->>TC: Start or SignalWithStart workflow
    TC-->>API: workflowId and run status
    API->>DB: Persist workflow run projection
    API-->>UI: Accepted run + status URL

    TC->>RT: Deliver generic Blueprint workflow task
    RT->>RT: Interpret validated steps and dependencies
    RT->>AG: Invoke scoped Jira tool
    AG->>AG: Authenticate runtime and evaluate policy
    AG->>Jira: Read release tasks
    Jira-->>AG: Evidence batch
    AG-->>RT: Validated scoped result

    RT->>AG: Invoke scoped GitHub tool
    AG->>AG: Re-check scope and capability
    AG->>GitHub: Read commits, PRs, and issues
    GitHub-->>AG: Evidence batch
    AG-->>RT: Validated scoped result

    RT-->>Data: Optional typed evidence/graph/memory boundary\n(current providers deferred)
    RT->>RT: Keep structured evidence references in result
    RT->>RT: Synthesize structured result with Gemini/ADK
    RT-->>TC: Complete workflow or wait for Signal
    TC-->>API: Queryable workflow state
    API->>DB: Update user-facing projection and audit event
    API-->>UI: Status, evidence, confidence, owners, next actions
```

If a release is unknown, the workflow should persist a reviewable blocked state and ask for a user signal or an approved data update. It should not silently invent a release, broaden permissions, or repeatedly spawn new agents.

## Update rules

Update this document when one of the following changes:

- a deployable service or public/private boundary is added or removed;
- a workflow moves between the API, Temporal, Runtime, or Agent Gateway;
- a data store becomes the source of truth for a category of data;
- an integration changes from mock/scaffold to a real adapter;
- authentication, policy, or service-to-service trust changes;
- the local or Google Cloud deployment path changes.

When only a user journey changes, update [`flows.md`](flows.md). When a technology choice or ownership rule changes, update [`architecture.md`](architecture.md) and record the implementation status here.
