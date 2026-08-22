CREATE TYPE "public"."knowledge_source_kind" AS ENUM('integration', 'uploaded_document', 'manual', 'media');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source_status" AS ENUM('draft', 'connecting', 'discovering', 'ingesting', 'active', 'degraded', 'needs_reauth', 'failed', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."source_ingestion_status" AS ENUM('queued', 'running', 'completed', 'deferred', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_ingestion_trigger" AS ENUM('bootstrap', 'manual', 'webhook', 'schedule', 'reconcile');--> statement-breakpoint
CREATE TYPE "public"."source_revision_status" AS ENUM('pending', 'ingesting', 'active', 'failed', 'superseded');--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
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
CREATE TABLE "source_ingestion_runs" (
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
CREATE TABLE "source_revisions" (
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
CREATE UNIQUE INDEX "knowledge_sources_id_organization_idx" ON "knowledge_sources" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sources_name_organization_idx" ON "knowledge_sources" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "source_ingestion_runs_id_organization_idx" ON "source_ingestion_runs" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_ingestion_runs_temporal_id_idx" ON "source_ingestion_runs" USING btree ("organization_id","temporal_workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_revisions_source_revision_idx" ON "source_revisions" USING btree ("source_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "source_revisions_id_organization_idx" ON "source_revisions" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_integration_scope_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."integrations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_ingestion_runs" ADD CONSTRAINT "source_ingestion_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_ingestion_runs" ADD CONSTRAINT "source_ingestion_runs_source_scope_fk" FOREIGN KEY ("source_id","organization_id") REFERENCES "public"."knowledge_sources"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_ingestion_runs" ADD CONSTRAINT "source_ingestion_runs_revision_scope_fk" FOREIGN KEY ("source_revision_id","organization_id") REFERENCES "public"."source_revisions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_revisions" ADD CONSTRAINT "source_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_revisions" ADD CONSTRAINT "source_revisions_source_scope_fk" FOREIGN KEY ("source_id","organization_id") REFERENCES "public"."knowledge_sources"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY knowledge_sources_tenant_isolation ON "knowledge_sources"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());--> statement-breakpoint
ALTER TABLE "source_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY source_revisions_tenant_isolation ON "source_revisions"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());--> statement-breakpoint
ALTER TABLE "source_ingestion_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY source_ingestion_runs_tenant_isolation ON "source_ingestion_runs"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "knowledge_sources" TO api_gateway;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "source_revisions" TO api_gateway;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "source_ingestion_runs" TO api_gateway;--> statement-breakpoint
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "knowledge_sources" FROM api_gateway;--> statement-breakpoint
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "source_revisions" FROM api_gateway;--> statement-breakpoint
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "source_ingestion_runs" FROM api_gateway;--> statement-breakpoint
COMMENT ON TABLE "knowledge_sources" IS 'Tenant-scoped logical knowledge origins. Integrations are one source kind; uploaded and manual data use the same ingestion boundary.';--> statement-breakpoint
COMMENT ON TABLE "source_revisions" IS 'Immutable source snapshots or revisions. Raw bytes remain in the artifact store; this table stores metadata and provenance references.';--> statement-breakpoint
COMMENT ON TABLE "source_ingestion_runs" IS 'Durable projection of a source-ingestion Temporal execution for audit, status, and retry visibility.';--> statement-breakpoint
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
