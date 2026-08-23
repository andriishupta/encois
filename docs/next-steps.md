# Next steps

This is the short product and engineering backlog after the current MVP slice.

## Product and UI

- Add server-backed pagination or **Load more**, with a default page size of 10, for Runs, Templates, Blueprints, Sources, and Notifications.
- Add consistent client-side validation, inline field errors, API error mapping, and schema validation at every form and contract boundary.
- Finish the dashboard visual system: dark theme, responsive layouts, keyboard navigation, focus states, and an accessibility review where status meaning does not depend on color.
- Complete loading, empty, stale, unavailable, forbidden, and retry states for every data-backed page without inventing product state in the browser.
- Add live or bounded-refresh updates for running workflows, review items, ingestion, and notifications; support real notification history and **Mark all as read**.
- Keep **Organization context** as the product name for the scoped graph surface; add richer search, filters, provenance, freshness, and safe graph inspection as the backend supports them.
- Persist useful canvas layout preferences and preserve the selected organization-unit scope across navigation and reloads.

## API and control plane

- Align workflow creation around Template, approved Blueprint, or manual intent; resolve Blueprint, revision, workflow, and Run identifiers on the server.
- Standardize pagination, sorting, filtering, status enums, validation errors, and request IDs across API projections.
- Add end-to-end local Temporal smoke coverage for onboarding completion, failure/retry, and Run controls.
- Keep Graph, Memory Bank, and provider mocks limited to explicit third-party or infrastructure adapter boundaries; never emulate missing product state.

## Quality and operations

- Add contract, authorization, onboarding-state, pagination, and tenant-isolation tests for the highest-risk API boundaries.
- Add one browser smoke path for Google login, onboarding completion, workflow creation, Run review, and forbidden access.
- Add CI checks for type safety, linting, builds, dependency/secret scanning, and a small production-like smoke environment.
- Verify hosted IAM, Temporal, Cloud Storage, Spanner Graph, Memory Bank, provider authorization, observability, retention, and rollback before production use.
