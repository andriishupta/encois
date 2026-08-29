# {{PRODUCT_NAME}} Documentation

_Last updated: 2026-08-23_

## What {{PRODUCT_NAME}} is

{{PRODUCT_NAME}} connects the systems your organization uses and turns their activity into shared, scope-aware context. It helps people understand what changed, investigate risks, review workflow results, and make decisions with evidence.

{{PRODUCT_NAME}} is read-oriented by default. A workflow or assistant may recommend something, but actions that change an external system require the appropriate permission and an explicit approval step.

## Start with the Dashboard

The Dashboard is your daily entry point. It is designed to give you useful context without requiring you to inspect every technical page.

- **Good morning** shows the signed-in account and active workspace.
- **Run workflow** opens the Workflows page so you can start an available workflow.
- **What changed recently** shows real workflow events visible in your current scope.
- **Pel AI** is the planned workspace assistant for questions, briefings, text chat, and voice. These surfaces are marked **Coming soon** until the assistant is connected to the product API.

The Dashboard never expands your access. It only shows information returned for the organization and organization unit you are allowed to see.

## Activity

Activity is the technical operations view. Use it when you need to inspect work that requires attention or a human decision.

- **Waiting approvals** — workflow runs paused for approval.
- **Running** — queued, running, or paused workflow runs.
- **Run attention** — failed or partially completed runs.
- **Source attention** — Sources that are degraded, failed, or need reauthorization.
- **Integration setup** — integrations that need authorization or recovery.
- **Blueprints** — approved workflow definitions selected when creating a Workflow.
- **Memory changes** — proposed workflow memory additions, corrections, or deletions.
- **Access requests** — organization-scope requests waiting for an administrator decision.

Each card links to the page that owns the underlying record. Individual items link to their details, while the arrow in a card opens the broader list.

## Workflows

Workflows are repeatable investigations or processes that collect scoped context and produce a result.

- **Workflows** — view available workflow definitions and start a workflow.
- **Runs** — view individual executions, their status, evidence, activity, and trace information.
- **Memory** — inspect workflow memory and review governed memory changes when you have access.
- **Templates** — reviewed starting points for creating a workflow.
- **Blueprints** — approved, versioned workflow definitions. A Blueprint describes the steps a workflow can execute.

Creating a workflow involves selecting a Template or existing Blueprint, configuring the workflow name and organization scope, previewing the resolved Blueprint, and creating it directly. An optional start is queued durably through the Coordinator outbox before Temporal execution begins.

## Organization

Organization pages describe the company context that {{PRODUCT_NAME}} uses.

- **Organization** — view the organization unit structure.
- **Memory** — explore the Organization Memory Graph: relationships, entities, and context visible in the current scope.
- **Sources** — manage unit-scoped Sources that provide context, such as documents or connected systems.
- **Integrations** — view supported system connections and their health. An integration is configured once for the organization; managers can then use it within the scopes they manage.
- **Investigations** — save and reopen bounded investigations.
- **Permissions** — manage organization-unit permissions when your role allows it.
- **Access** — view memberships and request or apply organization scope changes according to the approval rules.

## Organization units and scope

{{PRODUCT_NAME}} organizes access as a tree, for example:

`Organization → Department → Team → Project`

The organization-unit selector in the left menu shows the structure available to your session. You can switch only to units you are allowed to view. A manager may manage their assigned unit and, where policy allows, its descendants.

Changing the selected unit changes the scope of the pages and data you view. It does not grant additional permission.

## Access levels and permissions

Access level and permission are related but different:

| Access level | Typical capability |
| --- | --- |
| **Viewer** | Read permitted organization, workflow, source, and activity information. No management actions. |
| **Contributor** | Viewer capabilities plus supported contribution actions in the permitted scope. |
| **Manager** | Manage supported resources in the assigned unit and permitted descendants. |
| **Admin** | Organization-level administration, subject to the product permission and approval rules. |

The effective result depends on the user, organization membership, selected organization unit, permission, and resource scope. The UI may hide or disable actions that are not available, but the API remains the final authorization boundary.

Some operations are intentionally separate approval steps. For example, an access request can be proposed, approved, and applied; approving it does not silently change unrelated role permissions.

## Integrations and Sources

An **Integration** is the organization-level connection to a provider such as GitHub, Jira, Slack, or Google Workspace. Credentials and provider authorization are handled by the control plane; they are not exposed as browser data.

A **Source** is the organization-unit-level provider resource or uploaded content that provides information to {{PRODUCT_NAME}}. A provider Source references an existing Integration and selects the Jira project, GitHub repository, Slack channel, or similar resource. A manager can configure Sources within the organization unit they manage when the required permissions are available.

An organization-level integration can support multiple organization units. The source and its visibility scope determine where its information can be used.

## Product dictionary

- **Activity** — a technical event or an operations queue item that helps explain what {{PRODUCT_NAME}} is doing.
- **Blueprint** — an approved, versioned definition of workflow steps.
- **Evidence** — a source-backed reference that supports a workflow result or insight.
- **Integration** — an authorized connection to an external provider.
- **Source** — a document or connected provider resource that supplies context within an organization-unit scope.
- **Organization Memory Graph** — the organization’s visible entities and relationships.
- **Pel AI** — the planned {{PRODUCT_NAME}} workspace assistant for natural-language questions and personalized briefings.
- **Run** — one execution of a Workflow.
- **Scope** — the organization and organization units a user or resource is allowed to access.
- **Template** — a reviewed starting pattern for creating a Workflow.
- **Workflow** — a repeatable, scope-bound process or investigation.
- **Workflow Memory** — context associated with workflow and agent execution, separate from the Organization Memory Graph.

## When something is unavailable

An unavailable, restricted, or not-yet-connected capability is shown explicitly. It should not be interpreted as an empty organization or a successful operation. If you need access, ask an organization administrator to review your membership and organization-unit permissions.
