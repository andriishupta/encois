ALTER TABLE "workflow_runs"
  ADD COLUMN IF NOT EXISTS "name" text;

UPDATE "workflow_runs" AS runs
SET "name" = COALESCE(blueprints.name, runs.blueprint_id, runs.temporal_workflow_id)
FROM "workflow_blueprints" AS blueprints
WHERE runs.name IS NULL
  AND blueprints.organization_id = runs.organization_id
  AND blueprints.blueprint_id = runs.blueprint_id
  AND blueprints.version = runs.blueprint_version
  AND blueprints.deleted_at IS NULL;

UPDATE "workflow_runs"
SET "name" = COALESCE("blueprint_id", "temporal_workflow_id")
WHERE "name" IS NULL;

ALTER TABLE "workflow_runs"
  ALTER COLUMN "name" SET NOT NULL;
