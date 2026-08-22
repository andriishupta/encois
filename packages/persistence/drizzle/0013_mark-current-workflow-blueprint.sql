ALTER TABLE "workflow_blueprints" ADD COLUMN "is_current" boolean DEFAULT false NOT NULL;--> statement-breakpoint
WITH ranked_approved AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "organization_id", "blueprint_id"
    ORDER BY "updated_at" DESC, "version" DESC
  ) AS "rank"
  FROM "workflow_blueprints"
  WHERE "status" = 'approved'
)
UPDATE "workflow_blueprints" AS blueprint
SET "is_current" = true
FROM ranked_approved
WHERE blueprint."id" = ranked_approved."id"
  AND ranked_approved."rank" = 1;--> statement-breakpoint
