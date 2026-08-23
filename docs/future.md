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

## Future API boundary

The current UI change does not require API changes. When assistant behavior is implemented, add explicit, organization- and unit-scoped contracts for:

1. briefing generation with evidence and freshness;
2. conversation history and streaming responses;
3. user-authorized email/calendar/Slack context;
4. suggested actions with permission, approval, and audit metadata;
5. voice transcription and optional speech output.

Assistant output remains untrusted model output: validate it at the API boundary, preserve evidence references, apply deterministic authorization, and require explicit approval before any external write.
