# Encois

**Encois — Enterprise Context Intelligence System**

> **Hackathon:** [All Things Agentic](https://allthingsagentichackathon.devpost.com). The implementation should use the required Google ecosystem, including **Gemini, Google ADK / Agent Engine and Google Cloud**. Exact services should follow the hackathon requirements.

## Idea

**Encois is an intelligence layer for the entire company.**

It connects fragmented company signals from systems such as GitHub, Jira, Slack, Google Workspace, Stripe and infrastructure monitoring, then uses specialized agents to continuously understand what is happening, why it is happening, and what may require attention.

It is primarily **read-oriented**. Encois helps humans make decisions rather than autonomously running the company.

## Organizational Intelligence

Encois understands the company hierarchically:

**Company → Department → Team → Project → Person / System**

Different users see intelligence relevant to their scope:

- **CEO / CTO** — overall company health, delivery risks, major dependencies and trends.
- **Engineering Lead** — releases, incidents, blockers and team progress.
- **Sales Lead** — pipeline, stalled deals and relevant activity.
- **Finance** — revenue, costs and anomalies.
- **Individual contributor** — their projects, dependencies and risks.

The same underlying signals can therefore produce different intelligence depending on context.

## Agentic Architecture

A central **Intelligence Control Plane** dynamically launches small specialized agents.

Agents can run:

- on schedules;
- from webhooks/events;
- when anomalies appear;
- when another agent requests investigation;
- when a user asks a question.

Example:

`Deploy → production errors increase → investigation agents → GitHub + monitoring + Jira analysis → correlate events → surface probable cause and affected project`

Agents gather evidence and create structured intelligence rather than immediately taking actions.

## Example

A release is planned for **August 30**.

On August 20, Encois observes:

- critical Jira tasks remain unfinished;
- QA has not started;
- development activity has slowed;
- engineers have unresolved blockers;
- the latest deployment increased production errors.

Encois generates:

> **Release risk: High.** The August 30 target is unlikely. Testing has not started, three critical tasks remain incomplete, and the latest deployment correlates with increased production errors.

The CTO can ask:

> **Why are we likely to miss the release?**

Encois launches relevant agents, investigates the underlying systems and returns an evidence-backed explanation.

## Hackathon MVP

### Integrations

Keep it small:

- GitHub
- Jira or simulated project-management data
- Google Workspace
- one operational source such as monitoring or Stripe

### Core

- Gemini reasoning
- Google ADK agents
- dynamic agent spawning
- shared organizational context
- Company → Department → Team hierarchy
- event/scheduled investigations
- evidence-backed insights
- agent tracing / observability

### UI

One simple dashboard:

**Company Overview → Teams → Risks → Agent Activity**

Plus natural-language queries:

- _What should I worry about this week?_
- _Are we on track for the August 30 release?_
- _Why did engineering velocity drop?_
- _What changed after yesterday's deployment?_

## Product Direction

Encois starts as **Company Intelligence**, not company automation.

**Today:** Observe → correlate → understand → explain → recommend.

**Later:** Predict → request approval → execute controlled actions.

The long-term progression is:

**Company Observability → Company Intelligence → Company Execution**

### Positioning

> **Encois turns fragmented company activity into organizational intelligence.**

GitHub understands code. Jira understands tasks. Stripe understands money. Monitoring understands infrastructure.

**Encois understands how those signals relate to each other and what they mean for the company.**
