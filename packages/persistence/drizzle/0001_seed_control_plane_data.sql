-- Consolidated system seed data and permissions for a fresh control-plane database.

INSERT INTO "roles" ("organization_id", "key", "name", "description", "is_system")
VALUES
  (NULL, 'organization_admin', 'Organization administrator', 'Full control within one organization.', true),
  (NULL, 'manager', 'Manager', 'Read and manage assigned organizational scope.', true),
  (NULL, 'member', 'Member', 'Read and contribute within assigned scope.', true),
  (NULL, 'viewer', 'Viewer', 'Read-only access within assigned scope.', true);

--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "roles"."id", permissions.permission
FROM "roles"
JOIN (VALUES
  ('organization_admin', 'integrations:read'),
  ('organization_admin', 'integrations:manage'),
  ('organization_admin', 'onboarding:manage'),
  ('organization_admin', 'organization:read'),
  ('organization_admin', 'organization:manage'),
  ('organization_admin', 'settings:read'),
  ('organization_admin', 'settings:manage'),
  ('organization_admin', 'workflows:read'),
  ('organization_admin', 'workflows:run'),
  ('organization_admin', 'workflows:manage'),
  ('organization_admin', 'knowledge:read'),
  ('organization_admin', 'knowledge:manage'),
  ('manager', 'integrations:read'),
  ('manager', 'organization:read'),
  ('manager', 'organization:manage'),
  ('manager', 'settings:read'),
  ('manager', 'workflows:read'),
  ('manager', 'workflows:run'),
  ('manager', 'knowledge:read'),
  ('manager', 'knowledge:manage'),
  ('member', 'integrations:read'),
  ('member', 'organization:read'),
  ('member', 'settings:read'),
  ('member', 'workflows:read'),
  ('member', 'workflows:run'),
  ('member', 'knowledge:read'),
  ('member', 'knowledge:manage'),
  ('viewer', 'integrations:read'),
  ('viewer', 'organization:read'),
  ('viewer', 'settings:read'),
  ('viewer', 'workflows:read'),
  ('viewer', 'knowledge:read')
) AS permissions(role_key, permission) ON permissions.role_key = "roles"."key"
WHERE "roles"."organization_id" IS NULL;

--> statement-breakpoint

INSERT INTO "workflow_templates" (
  "key", "category", "title", "description", "keywords", "required_capabilities", "published_version", "status"
) VALUES
  ('release-readiness', 'engineering', 'Release Readiness Workflow', 'Review code changes, tracked work, and team communication before a release.', ARRAY['release', 'github', 'gitlab', 'jira', 'linear', 'slack', 'teams', 'pull-request'], ARRAY['code.read', 'pull-requests.read', 'issues.read', 'messages.read'], '1.0.0', 'published'),
  ('general-company-state', 'management', 'General Company State Workflow', 'Build a current, evidence-linked view of company delivery, risks, and team activity.', ARRAY['company', 'state', 'management', 'github', 'jira', 'slack', 'teams'], ARRAY['issues.read', 'code.read', 'messages.read', 'documents.read'], '1.0.0', 'published'),
  ('todays-status', 'management', 'Today''s Status Workflow', 'Summarize the most important activity and unresolved work from the current day.', ARRAY['today', 'status', 'daily', 'github', 'jira', 'slack', 'teams'], ARRAY['activity.read', 'issues.read', 'code.read', 'messages.read'], '1.0.0', 'published'),
  ('critical-issues', 'operations', 'Critical Issues Workflow', 'Find high-impact unresolved issues and explain their owners, age, and current risk.', ARRAY['critical', 'issues', 'incidents', 'jira', 'linear', 'slack', 'teams'], ARRAY['issues.read', 'incidents.read', 'messages.read'], '1.0.0', 'published'),
  ('automation-test-readiness', 'quality', 'Automation Test Readiness Workflow', 'Assess whether automated tests and recent CI runs provide enough confidence for a change.', ARRAY['testing', 'qa', 'automation', 'ci', 'github', 'gitlab', 'jira'], ARRAY['code.read', 'ci.read', 'issues.read'], '1.0.0', 'published'),
  ('prototype-readiness', 'design', 'Prototype Readiness Workflow', 'Check whether a product prototype has the evidence, decisions, and implementation context needed for review.', ARRAY['prototype', 'design', 'ux', 'figma', 'github', 'jira', 'linear'], ARRAY['design.read', 'code.read', 'issues.read'], '1.0.0', 'published'),
  ('documentation-state', 'documentation', 'Documentation State Workflow', 'Compare documentation changes with implementation and tracked work to identify drift.', ARRAY['documentation', 'docs', 'architecture', 'github', 'gitlab', 'jira', 'notion'], ARRAY['documents.read', 'code.read', 'issues.read'], '1.0.0', 'published'),
  ('engineering-delivery-health', 'engineering', 'Engineering Delivery Health Workflow', 'Explain delivery throughput, blockers, and aging work across engineering teams.', ARRAY['engineering', 'delivery', 'throughput', 'blockers', 'github', 'jira', 'linear'], ARRAY['code.read', 'issues.read', 'ci.read'], '1.0.0', 'published'),
  ('customer-escalations', 'customer-success', 'Customer Escalations Workflow', 'Connect customer escalations with tracked engineering work and team responses.', ARRAY['customer', 'support', 'escalations', 'zendesk', 'intercom', 'jira', 'slack'], ARRAY['support.read', 'issues.read', 'messages.read'], '1.0.0', 'published'),
  ('security-risk-review', 'security', 'Security Risk Review Workflow', 'Identify security-relevant changes, unresolved findings, and evidence gaps for review.', ARRAY['security', 'risk', 'vulnerability', 'github', 'gitlab', 'jira'], ARRAY['code.read', 'security-findings.read', 'issues.read'], '1.0.0', 'published');

--> statement-breakpoint

INSERT INTO "workflow_template_versions" (
  "workflow_template_id", "version", "schema_version", "template", "status"
)
SELECT workflows.id, '1.0.0', 'workflow-template.v1', templates.template, 'published'
FROM "workflow_templates" AS workflows
JOIN (
  VALUES
    ('release-readiness', $$
      {"schemaVersion":"workflow-template.v1","version":"1.0.0","workflowType":"encois.dynamic.v1","purpose":"Review code changes, tracked work, and team communication before a release.","inputs":{"scope":{"type":"execution-scope","description":"Organization, project, and team scope for the review.","required":true}},"providerSlots":[{"key":"source-control","capabilities":["code.read","pull-requests.read"],"preferredProviders":["github","gitlab"],"required":true},{"key":"issue-tracker","capabilities":["issues.read"],"preferredProviders":["jira","linear"],"required":true},{"key":"collaboration","capabilities":["messages.read"],"preferredProviders":["slack","teams"]}],"steps":[{"id":"collect-code-changes","kind":"tool","tool":"pull-requests.list","providerSlot":"source-control","input":{"state":"open-or-recent"}},{"id":"collect-tracked-work","kind":"tool","tool":"issues.search","providerSlot":"issue-tracker","input":{"state":"open"}},{"id":"summarize-release-readiness","kind":"agent","agentDefinition":"workflow-synthesis","dependsOn":["collect-code-changes","collect-tracked-work"],"input":{"instruction":"Identify release blockers, missing evidence, and recommended follow-ups."}}],"output":{"type":"release-readiness-report","description":"Evidence-linked release risks and follow-ups."}}
    $$::jsonb),
    ('general-company-state', $$
      {"schemaVersion":"workflow-template.v1","version":"1.0.0","workflowType":"encois.dynamic.v1","purpose":"Build a current, evidence-linked view of company delivery, risks, and team activity.","inputs":{"scope":{"type":"execution-scope","description":"Organization scope for the state review.","required":true}},"providerSlots":[{"key":"issue-tracker","capabilities":["issues.read"],"preferredProviders":["jira","linear"],"required":true},{"key":"source-control","capabilities":["code.read"],"preferredProviders":["github","gitlab"]},{"key":"collaboration","capabilities":["messages.read"],"preferredProviders":["slack","teams"]},{"key":"documents","capabilities":["documents.read"],"preferredProviders":["notion","google-drive"]}],"steps":[{"id":"collect-work","kind":"tool","tool":"issues.snapshot","providerSlot":"issue-tracker"},{"id":"collect-engineering","kind":"tool","tool":"code.activity","providerSlot":"source-control"},{"id":"collect-context","kind":"tool","tool":"messages.search","providerSlot":"collaboration"},{"id":"synthesize-company-state","kind":"agent","agentDefinition":"workflow-synthesis","dependsOn":["collect-work","collect-engineering","collect-context"],"input":{"instruction":"Separate observed facts, inferred risks, and missing evidence."}}],"output":{"type":"company-state-report","description":"Current company state with evidence, freshness, and risks."}}
    $$::jsonb),
    ('todays-status', $$
      {"schemaVersion":"workflow-template.v1","version":"1.0.0","workflowType":"encois.dynamic.v1","purpose":"Summarize the most important activity and unresolved work from the current day.","inputs":{"scope":{"type":"execution-scope","description":"Organization, project, or team scope.","required":true}},"providerSlots":[{"key":"activity-source","capabilities":["activity.read"],"preferredProviders":["github","gitlab","slack","teams"],"required":true},{"key":"issue-tracker","capabilities":["issues.read"],"preferredProviders":["jira","linear"],"required":true}],"steps":[{"id":"collect-todays-activity","kind":"tool","tool":"activity.today","providerSlot":"activity-source"},{"id":"collect-open-work","kind":"tool","tool":"issues.search","providerSlot":"issue-tracker","input":{"state":"open"}},{"id":"write-daily-status","kind":"agent","agentDefinition":"workflow-synthesis","dependsOn":["collect-todays-activity","collect-open-work"],"input":{"instruction":"Produce a concise status with completed work, active risks, and next actions."}}],"output":{"type":"daily-status-report","description":"A date-stamped status summary with evidence."}}
    $$::jsonb),
    ('critical-issues', $$
      {"schemaVersion":"workflow-template.v1","version":"1.0.0","workflowType":"encois.dynamic.v1","purpose":"Find high-impact unresolved issues and explain their owners, age, and current risk.","inputs":{"scope":{"type":"execution-scope","description":"Organization, project, or team scope.","required":true}},"providerSlots":[{"key":"issue-tracker","capabilities":["issues.read"],"preferredProviders":["jira","linear"],"required":true},{"key":"incident-source","capabilities":["incidents.read"],"preferredProviders":["pagerduty","opsgenie"]},{"key":"collaboration","capabilities":["messages.read"],"preferredProviders":["slack","teams"]}],"steps":[{"id":"find-critical-work","kind":"tool","tool":"issues.search","providerSlot":"issue-tracker","input":{"priority":"critical-or-high","state":"open"}},{"id":"collect-incidents","kind":"tool","tool":"incidents.search","providerSlot":"incident-source"},{"id":"explain-critical-risks","kind":"agent","agentDefinition":"workflow-synthesis","dependsOn":["find-critical-work","collect-incidents"],"input":{"instruction":"Rank risks using deterministic severity and preserve owner and freshness evidence."}}],"output":{"type":"critical-issues-report","description":"Prioritized critical issues with owners and evidence."}}
    $$::jsonb),
    ('automation-test-readiness', $$
      {"schemaVersion":"workflow-template.v1","version":"1.0.0","workflowType":"encois.dynamic.v1","purpose":"Assess whether automated tests and recent CI runs provide enough confidence for a change.","inputs":{"scope":{"type":"execution-scope","description":"Project and change scope for test readiness.","required":true}},"providerSlots":[{"key":"source-control","capabilities":["code.read"],"preferredProviders":["github","gitlab"],"required":true},{"key":"ci","capabilities":["ci.read"],"preferredProviders":["github-actions","gitlab-ci","circleci"],"required":true},{"key":"issue-tracker","capabilities":["issues.read"],"preferredProviders":["jira","linear"]}],"steps":[{"id":"collect-change","kind":"tool","tool":"code.changes","providerSlot":"source-control"},{"id":"collect-ci-runs","kind":"tool","tool":"ci.runs","providerSlot":"ci"},{"id":"assess-test-readiness","kind":"agent","agentDefinition":"workflow-synthesis","dependsOn":["collect-change","collect-ci-runs"],"input":{"instruction":"Report coverage of changed areas, failing checks, and evidence gaps without inventing test results."}}],"output":{"type":"test-readiness-report","description":"Test confidence and explicit evidence gaps."}}
    $$::jsonb),
    ('prototype-readiness', $$
      {"schemaVersion":"workflow-template.v1","version":"1.0.0","workflowType":"encois.dynamic.v1","purpose":"Check whether a product prototype has the evidence, decisions, and implementation context needed for review.","inputs":{"scope":{"type":"execution-scope","description":"Product project or prototype scope.","required":true}},"providerSlots":[{"key":"design-source","capabilities":["design.read"],"preferredProviders":["figma","penpot"],"required":true},{"key":"source-control","capabilities":["code.read"],"preferredProviders":["github","gitlab"]},{"key":"issue-tracker","capabilities":["issues.read"],"preferredProviders":["jira","linear"]}],"steps":[{"id":"collect-prototype","kind":"tool","tool":"design.prototype","providerSlot":"design-source"},{"id":"collect-implementation-context","kind":"tool","tool":"code.activity","providerSlot":"source-control"},{"id":"review-prototype-readiness","kind":"agent","agentDefinition":"workflow-synthesis","dependsOn":["collect-prototype","collect-implementation-context"],"input":{"instruction":"Identify unresolved UX decisions, implementation dependencies, and review readiness."}}],"output":{"type":"prototype-readiness-report","description":"Design readiness, dependencies, and unresolved decisions."}}
    $$::jsonb),
    ('documentation-state', $$
      {"schemaVersion":"workflow-template.v1","version":"1.0.0","workflowType":"encois.dynamic.v1","purpose":"Compare documentation changes with implementation and tracked work to identify drift.","inputs":{"scope":{"type":"execution-scope","description":"Repository, project, or documentation scope.","required":true}},"providerSlots":[{"key":"documents","capabilities":["documents.read"],"preferredProviders":["notion","google-drive","confluence"],"required":true},{"key":"source-control","capabilities":["code.read"],"preferredProviders":["github","gitlab"],"required":true},{"key":"issue-tracker","capabilities":["issues.read"],"preferredProviders":["jira","linear"]}],"steps":[{"id":"collect-documents","kind":"tool","tool":"documents.snapshot","providerSlot":"documents"},{"id":"collect-implementation","kind":"tool","tool":"code.structure","providerSlot":"source-control"},{"id":"find-documentation-drift","kind":"agent","agentDefinition":"workflow-synthesis","dependsOn":["collect-documents","collect-implementation"],"input":{"instruction":"Compare documented intent with implementation evidence and list stale or missing documentation."}}],"output":{"type":"documentation-state-report","description":"Documentation drift and evidence-linked update recommendations."}}
    $$::jsonb),
    ('engineering-delivery-health', $$
      {"schemaVersion":"workflow-template.v1","version":"1.0.0","workflowType":"encois.dynamic.v1","purpose":"Explain delivery throughput, blockers, and aging work across engineering teams.","inputs":{"scope":{"type":"execution-scope","description":"Engineering organization, team, or project scope.","required":true}},"providerSlots":[{"key":"issue-tracker","capabilities":["issues.read"],"preferredProviders":["jira","linear"],"required":true},{"key":"source-control","capabilities":["code.read"],"preferredProviders":["github","gitlab"]},{"key":"ci","capabilities":["ci.read"],"preferredProviders":["github-actions","gitlab-ci"]}],"steps":[{"id":"collect-delivery-work","kind":"tool","tool":"issues.delivery-metrics","providerSlot":"issue-tracker"},{"id":"collect-code-flow","kind":"tool","tool":"code.flow","providerSlot":"source-control"},{"id":"explain-delivery-health","kind":"agent","agentDefinition":"workflow-synthesis","dependsOn":["collect-delivery-work","collect-code-flow"],"input":{"instruction":"Explain trends and blockers from observed data; do not infer productivity from individual surveillance."}}],"output":{"type":"delivery-health-report","description":"Team-level delivery trends, blockers, and evidence freshness."}}
    $$::jsonb),
    ('customer-escalations', $$
      {"schemaVersion":"workflow-template.v1","version":"1.0.0","workflowType":"encois.dynamic.v1","purpose":"Connect customer escalations with tracked engineering work and team responses.","inputs":{"scope":{"type":"execution-scope","description":"Customer segment, product, or organization scope.","required":true}},"providerSlots":[{"key":"support","capabilities":["support.read"],"preferredProviders":["zendesk","intercom"],"required":true},{"key":"issue-tracker","capabilities":["issues.read"],"preferredProviders":["jira","linear"]},{"key":"collaboration","capabilities":["messages.read"],"preferredProviders":["slack","teams"]}],"steps":[{"id":"collect-escalations","kind":"tool","tool":"support.escalations","providerSlot":"support"},{"id":"find-engineering-work","kind":"tool","tool":"issues.search","providerSlot":"issue-tracker"},{"id":"connect-escalations","kind":"agent","agentDefinition":"workflow-synthesis","dependsOn":["collect-escalations","find-engineering-work"],"input":{"instruction":"Link escalations to evidence-backed work items and clearly mark unmatched cases."}}],"output":{"type":"customer-escalations-report","description":"Escalations linked to ownership, status, and next actions."}}
    $$::jsonb),
    ('security-risk-review', $$
      {"schemaVersion":"workflow-template.v1","version":"1.0.0","workflowType":"encois.dynamic.v1","purpose":"Identify security-relevant changes, unresolved findings, and evidence gaps for review.","inputs":{"scope":{"type":"execution-scope","description":"Repository, service, or organization security scope.","required":true}},"providerSlots":[{"key":"source-control","capabilities":["code.read"],"preferredProviders":["github","gitlab"],"required":true},{"key":"security","capabilities":["security-findings.read"],"preferredProviders":["github-security","snyk","dependabot"],"required":true},{"key":"issue-tracker","capabilities":["issues.read"],"preferredProviders":["jira","linear"]}],"steps":[{"id":"collect-security-changes","kind":"tool","tool":"code.security-changes","providerSlot":"source-control"},{"id":"collect-findings","kind":"tool","tool":"security.findings","providerSlot":"security"},{"id":"review-security-risk","kind":"agent","agentDefinition":"workflow-synthesis","dependsOn":["collect-security-changes","collect-findings"],"input":{"instruction":"Prioritize findings and evidence gaps; do not make remediation changes or claim a vulnerability without source evidence."}}],"output":{"type":"security-risk-report","description":"Security findings, change context, and reviewable evidence gaps."}}
    $$::jsonb)
) AS templates(key, template) ON templates.key = workflows.key
WHERE workflows.organization_id IS NULL;

--> statement-breakpoint

COMMENT ON TABLE "workflow_templates" IS 'Provider-neutral workflow templates. Published rows are catalog input for Workflow Creator, not executable Runtime definitions.';

--> statement-breakpoint

COMMENT ON TABLE "workflow_template_versions" IS 'Immutable versioned JSONB snapshots for workflow templates.';

--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "roles"."id", permissions.permission
FROM "roles"
JOIN (VALUES
  ('organization_admin', 'onboarding:manage'),
  ('organization_admin', 'organization:read'),
  ('organization_admin', 'organization:manage'),
  ('organization_admin', 'settings:read'),
  ('organization_admin', 'settings:manage'),
  ('manager', 'organization:read'),
  ('manager', 'organization:manage'),
  ('manager', 'settings:read'),
  ('member', 'organization:read'),
  ('member', 'settings:read'),
  ('viewer', 'organization:read'),
  ('viewer', 'settings:read')
) AS permissions(role_key, permission) ON permissions.role_key = "roles"."key"
WHERE "roles"."organization_id" IS NULL
ON CONFLICT ("role_id", "permission") DO NOTHING;

--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "roles"."id", permissions.permission
FROM "roles"
JOIN (VALUES
  ('organization_admin', 'context:read'),
  ('organization_admin', 'memory:read')
) AS permissions(role_key, permission) ON permissions.role_key = "roles"."key"
WHERE "roles"."organization_id" IS NULL
ON CONFLICT ("role_id", "permission") DO NOTHING;

--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "roles"."id", 'memory:manage'
FROM "roles"
WHERE "roles"."organization_id" IS NULL AND "roles"."key" = 'organization_admin'
ON CONFLICT ("role_id", "permission") DO NOTHING;

--> statement-breakpoint

INSERT INTO "organization_onboarding" ("organization_id", "coordinator_id")
SELECT "id", 'organization:' || "id" FROM "organizations"
ON CONFLICT ("organization_id") DO NOTHING;
