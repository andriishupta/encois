# Encois System Diagram

**Status:** living current-state map  
**Last reviewed:** 2026-08-20  
**Purpose:** keep one diagram that shows the current system shape, deployable boundaries, and the parts that are still scaffold or deferred.

This document is the visual map of the repository. It should be updated when a service boundary, runtime responsibility, data store, or deployment path changes. Detailed behavioral scenarios belong in [`flows.md`](flows.md); component decisions belong in [`architecture.md`](architecture.md).

## Legend

- Green: implemented boundary or working local path.
- Yellow: implemented scaffold, mock, or deliberately incomplete enforcement.
- Blue: target or deferred capability.
- Gray: external system or managed platform.
- Dashed arrows: optional, future, or not yet connected in the current vertical slice.

## Current system overview

```mermaid
flowchart TB
    Human[Human users]
    MCP[Future MCP clients]
    Edge[HTTPS edge / Load Balancer\nTarget GCP deployment]

    subgraph Public[Public application plane]
        Web[React SPA\napps/dashboard\nTanStack Router + Query\nCurrent: UI scaffold and local state]
        API[Gateway API\napps/api-gateway\nHono + TypeScript\nAuth, scope, registry, workflow control]
        Auth[Identity Platform\nCurrent: adapter exists\nServer wiring pending]
        SQL[(Cloud SQL PostgreSQL\nDrizzle + RLS\nCurrent: schema and migration foundation)]
    end

    subgraph Durable[Durable execution plane]
        Temporal[Temporal Cloud\nCurrent: client integration + local fallback\nTarget: Cloud execution history, retries, Signals, timers]
        Runtime[Go Agent Runtime\napps/agent-runtime\nTemporal worker + Google ADK\nCurrent: workflows, activities, fixtures]
    end

    subgraph Private[Private agent plane]
        AgentGateway[Agent Gateway\napps/agent-gateway\nGin policy and tool broker\nCurrent: mock tools + allow-all scaffold]
        Policy[Deterministic policy\nscope, capability, approval\nTarget: enforced service boundary]
        Integrations[Integration adapters\nJira, GitHub, Workspace, monitoring\nCurrent: synthetic fixtures]
    end

    subgraph Knowledge[Knowledge and evidence plane]
        Gemini[Vertex AI / Gemini\nADK model calls and synthesis]
        Memory[Agent Engine Sessions + Memory Bank\nTarget: scoped agent memory]
        Graph[(Spanner Graph\nTarget: company entities, facts, relationships)]
        Storage[(Cloud Storage\nTarget: raw snapshots and artifacts)]
    end

    Sources[GitHub / Jira / Google Workspace / monitoring\nExternal systems]
    Ops[Cloud Logging / Trace / Metrics\nCurrent: partial instrumentation]

    Human --> Edge
    MCP -. future .-> Edge
    Edge --> Web
    Edge --> API
    Web --> API
    API --> Auth
    API --> SQL
    API --> Temporal
    Temporal -. polls task queues .-> Runtime
    Runtime --> AgentGateway
    AgentGateway --> Policy
    AgentGateway --> Integrations
    Integrations --> Sources
    Runtime --> Gemini
    Runtime -. scoped memory .-> Memory
    AgentGateway -. normalized facts .-> Graph
    AgentGateway -. raw payloads .-> Storage
    API -. projections / queries .-> Graph
    API -. scoped memory operations .-> Memory
    API -. evidence references .-> Storage
    API -.-> Ops
    Temporal -.-> Ops
    Runtime -.-> Ops
    AgentGateway -.-> Ops

    classDef live fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef scaffold fill:#fef3c7,stroke:#b45309,color:#78350f
    classDef target fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef external fill:#e5e7eb,stroke:#6b7280,color:#1f2937

    class Web,API,SQL,Runtime,Gemini live
    class Auth,Temporal,AgentGateway,Policy,Integrations,Ops scaffold
    class Memory,Graph,Storage target
    class Human,MCP,Edge,Sources external
```

The diagram intentionally shows the architecture and the implementation status together. The current demo path can use local UI state, an in-memory Temporal adapter, and synthetic provider fixtures. The target path keeps the same boundaries but replaces those adapters with authenticated services and managed Google Cloud resources.

## Deployable service boundaries

```mermaid
flowchart LR
    subgraph DashboardService[Cloud Run: Dashboard]
        Dashboard[Static React SPA\nNo provider credentials\nCalls only Gateway API]
    end

    subgraph ApiService[Cloud Run: Gateway API]
        Routes[Hono routes]
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
        ADK[Google ADK agents\nplanner, specialists, synthesizer]
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
    Evidence[(Cloud Storage)]
    CompanyGraph[(Spanner Graph)]
    AgentMemory[(Memory Bank)]

    Dashboard --> Routes
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
    Activities -. evidence .-> Evidence
    Activities -. facts .-> CompanyGraph
    ADK -. scoped memory .-> AgentMemory

    classDef live fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef scaffold fill:#fef3c7,stroke:#b45309,color:#78350f
    classDef target fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef external fill:#e5e7eb,stroke:#6b7280,color:#1f2937

    class Dashboard,Routes,Middleware,Control,TemporalClient,Persistence,Worker,Workflows,Activities,ADK live
    class GatewayHTTP,GatewayAuth,GatewayPolicy,ToolRegistry,ProviderAdapters scaffold
    class Evidence,CompanyGraph,AgentMemory target
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

    RT->>Data: Store evidence references and projection
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
