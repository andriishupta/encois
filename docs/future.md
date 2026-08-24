# Future product direction

## Dashboard: Pel AI workspace assistant

Dashboard is the authenticated entry point for people who may never open the operational pages. It should feel like a second brain for the current organization scope, not like a monitoring console.

- Greet the user by their account name and explain what changed in the visible scope.
- Present a grounded morning brief with recent, evidence-backed changes.
- Let the user ask questions such as “What changed last week?” or “What should I know today?”
- Support text chat first and voice input/output later through the same scoped assistant context.
- Add quick actions such as Run workflow and Check integrations without making technical queues the primary content.
- Show email, calendar, Slack, and other personal signals only after the user explicitly connects and authorizes them.
- Keep suggested actions visibly marked as unavailable or coming soon until the API can execute them.

The Dashboard must never manufacture an insight, activity event, connection, or suggested action. Until assistant APIs exist, the UI may show real workflow activity and clearly labelled coming-soon surfaces only.

## Activity: technical operations view

`/activity` replaces `/review` as the technical inbox. It gathers operational work without making it the Dashboard’s primary experience:

- waiting approvals;
- running workflow runs;
- failed or partial runs needing attention;
- source attention;
- integration setup;
- workflow plan and memory-change approvals;
- organization access requests.

Summary cards link to the owning product surface. Individual rows link to the relevant workflow, source, integration, or organization request. Workflow run links should lead to the aggregate Runs page when the user asks to see the complete run history.

## Provider-neutral memory and storage plane

The current MVP keeps provider access behind three small boundaries:

| Boundary | Current implementation | Future replacement options |
| --- | --- | --- |
| Organization Memory Graph | Local adapter or tenant-keyed Spanner projection | Spanner Graph views, another graph store, or a customer-owned graph API |
| Workflow Memory | Local adapter or Vertex AI Memory Bank adapter | Exact scoped provider reads, an Encois filtered projection, AWS memory, or a customer-owned memory API |
| Raw Artifacts | Local process adapter or Cloud Storage | S3-compatible storage or a customer-owned artifact API |

The product contract should remain provider-neutral: organization ID,
authorized visibility scope, actor/workflow/request IDs, provenance, freshness,
retention, classification, and redaction state. GCP, AWS, or customer-provider
IDs and SDK payloads stay inside adapters. Product UI and permissions should
continue to use terms such as Organization Memory Graph and Workflow Memory,
not provider names.

The current local and GCP paths are not equivalent in all respects. The API
already authorizes organization-unit scope, and the Graph projection carries
visibility scope. The current Vertex Memory Bank adapter uses exact provider
scope keys for organization, agent, and optional project/user, but does not yet
materialize the full Encois unit hierarchy inside Memory Bank. A future change
must choose between exact per-scope reads, a trusted Encois-side filtered
projection, or a customer-owned scoped store. Provider failure to support the
requested scope must fail closed rather than widen the result.

Cloud Storage object prefixes are defense in depth and support retention and
ownership boundaries, but API authorization remains authoritative. Direct
bucket listing must not be used as a user-facing access mechanism.

The canonical current/future behavior and security invariants are in
[`memory.md`](memory.md). No provider migration or database rewrite is implied
by this direction.

### Customer-owned memory option

Some customers may require company memory and raw artifacts to remain in their
own environment. A future customer adapter can call a versioned Encois API
implemented by that customer. It must use authenticated service-to-service
access, bind organization and visibility scope to the customer identity, keep
read/write capabilities separate, enforce bounded payloads and retries, and
return normalized evidence with provenance. Encois should not depend on the
customer's database schema or treat the external store as the authorization
source.

This is a future deployment option, not a current local mode. The first
implementation step is contract-level scope semantics and adapter tests; AWS
or customer-specific integrations should wait until those contracts stabilize.

## Future API boundary

The current UI change does not require API changes. When assistant behavior is implemented, add explicit, organization- and unit-scoped contracts for:

1. briefing generation with evidence and freshness;
2. conversation history and streaming responses;
3. user-authorized email/calendar/Slack context;
4. suggested actions with permission, approval, and audit metadata;
5. voice transcription and optional speech output.

Assistant output remains untrusted model output: validate it at the API boundary, preserve evidence references, apply deterministic authorization, and require explicit approval before any external write.
