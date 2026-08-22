ALTER TABLE "workflow_change_plans" ADD COLUMN IF NOT EXISTS "planner_name" text;
ALTER TABLE "workflow_change_plans" ADD COLUMN IF NOT EXISTS "planner_version" text;
ALTER TABLE "workflow_change_plans" ADD COLUMN IF NOT EXISTS "source_schema_version" text;
ALTER TABLE "workflow_change_plans" ADD COLUMN IF NOT EXISTS "prompt_version" text;
ALTER TABLE "workflow_change_plans" ADD COLUMN IF NOT EXISTS "prompt_hash" text;
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "retention_until" timestamptz;

-- Existing terminal runs predate the retention column. Backfill them with the
-- default control-plane retention window so they enter the same cleanup path.
UPDATE "workflow_runs"
SET "retention_until" = "created_at" + interval '30 days'
WHERE "retention_until" IS NULL
  AND "status" IN ('completed', 'failed', 'partial', 'cancelled');

COMMENT ON COLUMN "workflow_change_plans"."prompt_hash" IS 'Non-reversible hash of the user planner input; raw prompts are not persisted here.';
COMMENT ON COLUMN "workflow_runs"."retention_until" IS 'Retention deadline for the run record and its workflow-event/evidence linkage.';
