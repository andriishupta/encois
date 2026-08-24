DO $$
BEGIN
  -- Drizzle runs pending migrations in one transaction. PostgreSQL does not
  -- allow a newly-added enum value to be used before that transaction commits,
  -- so recreate the enum atomically instead of adding values in place.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumtypid = 'public.workflow_template_status'::regtype
      AND enumlabel = 'active'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumtypid = 'public.workflow_template_status'::regtype
      AND enumlabel = 'deleted'
  ) THEN
    ALTER TABLE "public"."workflow_templates"
      ALTER COLUMN "status" DROP DEFAULT;

    CREATE TYPE "public"."workflow_template_status_next" AS ENUM(
      'draft', 'published', 'active', 'disabled', 'deleted', 'retired'
    );

    ALTER TABLE "public"."workflow_templates"
      ALTER COLUMN "status" TYPE "public"."workflow_template_status_next"
      USING "status"::text::"public"."workflow_template_status_next";

    DROP TYPE "public"."workflow_template_status";
    ALTER TYPE "public"."workflow_template_status_next"
      RENAME TO "workflow_template_status";

    ALTER TABLE "public"."workflow_templates"
      ALTER COLUMN "status" SET DEFAULT 'draft';
  END IF;
END $$;
