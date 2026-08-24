-- Keep the broad product catalog visible, but make unsupported runtime tools
-- explicitly unavailable until their Agent Gateway adapters exist.
UPDATE "workflow_templates"
SET "status" = 'disabled', "updated_at" = now()
WHERE "organization_id" IS NULL
  AND "key" IN (
    'release-readiness',
    'general-company-state',
    'todays-status',
    'critical-issues',
    'automation-test-readiness',
    'prototype-readiness',
    'documentation-state',
    'engineering-delivery-health',
    'customer-escalations',
    'security-risk-review'
  );

-- Preserve tenant-owned templates that were published before the explicit
-- active/disabled lifecycle was introduced.
UPDATE "workflow_templates"
SET "status" = 'active', "updated_at" = now()
WHERE "organization_id" IS NOT NULL
  AND "status" = 'published';

--> statement-breakpoint

INSERT INTO "workflow_templates" (
  "key", "category", "title", "description", "keywords", "required_capabilities", "published_version", "status"
)
VALUES
  ('github-project-activity', 'engineering', 'GitHub Project Activity', 'Collect pull requests, checks, and commits for a project scope, then summarize the observed delivery context.', ARRAY['github', 'project', 'pull-request', 'checks', 'commits'], ARRAY['code.read'], '1.0.0', 'active'),
  ('github-repository-activity', 'engineering', 'GitHub Repository Activity', 'Collect pull requests, checks, and commits for a repository scope, then summarize the observed delivery context.', ARRAY['github', 'repository', 'pull-request', 'checks', 'commits'], ARRAY['code.read'], '1.0.0', 'active'),
  ('jira-project-tasks', 'planning', 'Jira Project Tasks', 'Read task status for a Jira project scope and summarize completed, remaining, and blocked work.', ARRAY['jira', 'project', 'tasks', 'issues', 'planning'], ARRAY['issues.read'], '1.0.0', 'active');

--> statement-breakpoint

INSERT INTO "workflow_template_versions" (
  "workflow_template_id", "version", "schema_version", "template", "status"
)
SELECT workflows.id, '1.0.0', 'workflow-template.v1', templates.template, 'published'
FROM "workflow_templates" AS workflows
JOIN (
  VALUES
    ('github-project-activity', $$
      {"schemaVersion":"workflow-template.v1","version":"1.0.0","workflowType":"encois.dynamic.v1","purpose":"Collect pull requests, checks, and commits for a project scope, then summarize the observed delivery context.","inputs":{"scope":{"type":"execution-scope","description":"Organization-unit scope for the project activity review.","required":true}},"providerSlots":[{"key":"github-project","capabilities":["code.read"],"preferredProviders":["github"],"required":true}],"steps":[{"id":"collect-project-activity","kind":"tool","tool":"github.project_activity","providerSlot":"github-project"},{"id":"summarize-project-activity","kind":"agent","agentDefinition":"context.synthesizer@1","dependsOn":["collect-project-activity"]}],"output":{"type":"github-project-activity-report","description":"Evidence-linked GitHub project activity with freshness and unresolved gaps."}}
    $$::jsonb),
    ('github-repository-activity', $$
      {"schemaVersion":"workflow-template.v1","version":"1.0.0","workflowType":"encois.dynamic.v1","purpose":"Collect pull requests, checks, and commits for a repository scope, then summarize the observed delivery context.","inputs":{"scope":{"type":"execution-scope","description":"Organization-unit scope for the repository activity review.","required":true}},"providerSlots":[{"key":"github-repository","capabilities":["code.read"],"preferredProviders":["github"],"required":true}],"steps":[{"id":"collect-repository-activity","kind":"tool","tool":"github.repository_activity","providerSlot":"github-repository"},{"id":"summarize-repository-activity","kind":"agent","agentDefinition":"context.synthesizer@1","dependsOn":["collect-repository-activity"]}],"output":{"type":"github-repository-activity-report","description":"Evidence-linked GitHub repository activity with freshness and unresolved gaps."}}
    $$::jsonb),
    ('jira-project-tasks', $$
      {"schemaVersion":"workflow-template.v1","version":"1.0.0","workflowType":"encois.dynamic.v1","purpose":"Read task status for a Jira project scope and summarize completed, remaining, and blocked work.","inputs":{"scope":{"type":"execution-scope","description":"Organization-unit scope for the Jira project review.","required":true}},"providerSlots":[{"key":"jira-project","capabilities":["issues.read"],"preferredProviders":["jira"],"required":true}],"steps":[{"id":"collect-project-tasks","kind":"tool","tool":"jira.project_tasks","providerSlot":"jira-project"},{"id":"summarize-project-tasks","kind":"agent","agentDefinition":"context.synthesizer@1","dependsOn":["collect-project-tasks"]}],"output":{"type":"jira-project-task-report","description":"Evidence-linked Jira task status with freshness and unresolved gaps."}}
    $$::jsonb)
) AS templates(key, template) ON templates.key = workflows.key
WHERE workflows.organization_id IS NULL;
