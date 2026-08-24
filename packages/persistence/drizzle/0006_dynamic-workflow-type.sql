-- Rename the platform executable type used by new Dynamic workflow runs.
-- Historical workflow runs are intentionally not migrated.
UPDATE "workflow_template_versions"
SET "template" = jsonb_set(
  "template",
  '{workflowType}',
  to_jsonb('encois.dynamic.v1'::text),
  true
)
WHERE "template"->>'workflowType' = 'encois.user-blueprint.v1';

--> statement-breakpoint

-- Keep an already-existing canonical definition if one was created manually.
-- Old definitions remain only for referential integrity of historical runs.
UPDATE "workflow_definitions" AS definitions
SET "key" = 'encois.dynamic.v1', "updated_at" = now()
WHERE definitions."key" = 'encois.user-blueprint.v1'
  AND NOT EXISTS (
    SELECT 1
    FROM "workflow_definitions" AS canonical
    WHERE canonical."organization_id" IS NOT DISTINCT FROM definitions."organization_id"
      AND canonical."key" = 'encois.dynamic.v1'
      AND canonical."version" = definitions."version"
  );
