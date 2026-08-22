DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'knowledge_source_kind') THEN
    CREATE TYPE "public"."knowledge_source_kind" AS ENUM('integration', 'uploaded_document', 'manual', 'media');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'knowledge_source_status') THEN
    CREATE TYPE "public"."knowledge_source_status" AS ENUM('draft', 'connecting', 'discovering', 'ingesting', 'active', 'degraded', 'needs_reauth', 'failed', 'disabled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'source_revision_status') THEN
    CREATE TYPE "public"."source_revision_status" AS ENUM('pending', 'ingesting', 'active', 'failed', 'superseded');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'source_ingestion_trigger') THEN
    CREATE TYPE "public"."source_ingestion_trigger" AS ENUM('bootstrap', 'manual', 'webhook', 'schedule', 'reconcile');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'source_ingestion_status') THEN
    CREATE TYPE "public"."source_ingestion_status" AS ENUM('queued', 'running', 'completed', 'deferred', 'failed');
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "kind" "knowledge_source_kind" NOT NULL,
  "provider" text,
  "integration_id" uuid,
  "status" "knowledge_source_status" DEFAULT 'draft' NOT NULL,
  "read_scope" jsonb NOT NULL,
  "visibility_scope" jsonb NOT NULL,
  "content_type" text,
  "configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "current_revision_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "revision" text NOT NULL,
  "status" "source_revision_status" DEFAULT 'pending' NOT NULL,
  "artifact_ref" text,
  "source_object_id" text,
  "content_type" text,
  "checksum" text,
  "observed_at" timestamp with time zone,
  "ingested_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_ingestion_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "source_revision_id" uuid NOT NULL,
  "temporal_workflow_id" text NOT NULL,
  "temporal_run_id" text,
  "trigger" "source_ingestion_trigger" NOT NULL,
  "status" "source_ingestion_status" DEFAULT 'queued' NOT NULL,
  "current_stage" text,
  "facts_count" integer DEFAULT 0 NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_sources_id_organization_idx" ON "knowledge_sources" USING btree ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_sources_name_organization_idx" ON "knowledge_sources" USING btree ("organization_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "source_revisions_source_revision_idx" ON "source_revisions" USING btree ("source_id", "revision");
CREATE UNIQUE INDEX IF NOT EXISTS "source_revisions_id_organization_idx" ON "source_revisions" USING btree ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "source_ingestion_runs_id_organization_idx" ON "source_ingestion_runs" USING btree ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "source_ingestion_runs_temporal_id_idx" ON "source_ingestion_runs" USING btree ("organization_id", "temporal_workflow_id");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_sources_organization_id_organizations_id_fk') THEN
    ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_sources_integration_scope_fk') THEN
    ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_integration_scope_fk" FOREIGN KEY ("integration_id", "organization_id") REFERENCES "public"."integrations"("id", "organization_id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_revisions_organization_id_organizations_id_fk') THEN
    ALTER TABLE "source_revisions" ADD CONSTRAINT "source_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_revisions_source_scope_fk') THEN
    ALTER TABLE "source_revisions" ADD CONSTRAINT "source_revisions_source_scope_fk" FOREIGN KEY ("source_id", "organization_id") REFERENCES "public"."knowledge_sources"("id", "organization_id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_ingestion_runs_organization_id_organizations_id_fk') THEN
    ALTER TABLE "source_ingestion_runs" ADD CONSTRAINT "source_ingestion_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_ingestion_runs_source_scope_fk') THEN
    ALTER TABLE "source_ingestion_runs" ADD CONSTRAINT "source_ingestion_runs_source_scope_fk" FOREIGN KEY ("source_id", "organization_id") REFERENCES "public"."knowledge_sources"("id", "organization_id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_ingestion_runs_revision_scope_fk') THEN
    ALTER TABLE "source_ingestion_runs" ADD CONSTRAINT "source_ingestion_runs_revision_scope_fk" FOREIGN KEY ("source_revision_id", "organization_id") REFERENCES "public"."source_revisions"("id", "organization_id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "knowledge_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_ingestion_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'knowledge_sources_tenant_isolation' AND polrelid = 'knowledge_sources'::regclass) THEN
    CREATE POLICY knowledge_sources_tenant_isolation ON "knowledge_sources" USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'source_revisions_tenant_isolation' AND polrelid = 'source_revisions'::regclass) THEN
    CREATE POLICY source_revisions_tenant_isolation ON "source_revisions" USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'source_ingestion_runs_tenant_isolation' AND polrelid = 'source_ingestion_runs'::regclass) THEN
    CREATE POLICY source_ingestion_runs_tenant_isolation ON "source_ingestion_runs" USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());
  END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "knowledge_sources" TO api_gateway;
GRANT SELECT, INSERT, UPDATE ON "source_revisions" TO api_gateway;
GRANT SELECT, INSERT, UPDATE ON "source_ingestion_runs" TO api_gateway;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "knowledge_sources" FROM api_gateway;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "source_revisions" FROM api_gateway;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "source_ingestion_runs" FROM api_gateway;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "roles"."id", permissions.permission
FROM "roles"
JOIN (VALUES
  ('organization_admin', 'knowledge:read'),
  ('organization_admin', 'knowledge:manage'),
  ('manager', 'knowledge:read'),
  ('manager', 'knowledge:manage'),
  ('member', 'knowledge:read'),
  ('member', 'knowledge:manage'),
  ('viewer', 'knowledge:read')
) AS permissions(role_key, permission) ON permissions.role_key = "roles"."key"
ON CONFLICT ("role_id", "permission") DO NOTHING;
