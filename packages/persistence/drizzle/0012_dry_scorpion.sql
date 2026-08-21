ALTER TYPE "public"."suggested_workflow_status" RENAME TO "workflow_template_status";--> statement-breakpoint
ALTER TYPE "public"."suggested_workflow_version_status" RENAME TO "workflow_template_version_status";--> statement-breakpoint
ALTER TABLE "suggested_workflow_versions" RENAME TO "workflow_template_versions";--> statement-breakpoint
ALTER TABLE "suggested_workflows" RENAME TO "workflow_templates";--> statement-breakpoint
ALTER TABLE "workflow_template_versions" RENAME COLUMN "suggested_workflow_id" TO "workflow_template_id";--> statement-breakpoint
ALTER POLICY suggested_workflows_tenant_isolation ON "workflow_templates" RENAME TO workflow_templates_tenant_isolation;--> statement-breakpoint
ALTER POLICY suggested_workflow_versions_tenant_isolation ON "workflow_template_versions" RENAME TO workflow_template_versions_tenant_isolation;--> statement-breakpoint
UPDATE "workflow_template_versions"
SET "schema_version" = 'workflow-template.v1',
    "template" = jsonb_set("template", '{schemaVersion}', to_jsonb('workflow-template.v1'::text))
WHERE "schema_version" = 'suggested-workflow-template.v1';--> statement-breakpoint
ALTER TABLE "workflow_template_versions" DROP CONSTRAINT "suggested_workflow_versions_template_version_check";--> statement-breakpoint
ALTER TABLE "workflow_template_versions" DROP CONSTRAINT "suggested_workflow_versions_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "workflow_template_versions" DROP CONSTRAINT "suggested_workflow_versions_suggested_workflow_id_suggested_wor";
--> statement-breakpoint
ALTER TABLE "workflow_templates" DROP CONSTRAINT "suggested_workflows_organization_id_organizations_id_fk";
--> statement-breakpoint
DROP INDEX "suggested_workflow_versions_identity_idx";--> statement-breakpoint
DROP INDEX "suggested_workflow_versions_id_idx";--> statement-breakpoint
DROP INDEX "suggested_workflows_scope_key_idx";--> statement-breakpoint
DROP INDEX "suggested_workflows_id_organization_idx";--> statement-breakpoint
ALTER TABLE "workflow_template_versions" ADD CONSTRAINT "workflow_template_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_versions" ADD CONSTRAINT "workflow_template_versions_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_template_versions_identity_idx" ON "workflow_template_versions" USING btree ("workflow_template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_template_versions_id_idx" ON "workflow_template_versions" USING btree ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_scope_key_idx" ON "workflow_templates" USING btree ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_id_organization_idx" ON "workflow_templates" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "workflow_template_versions" ADD CONSTRAINT "workflow_template_versions_template_version_check" CHECK ("workflow_template_versions"."template"->>'version' = "workflow_template_versions"."version" AND "workflow_template_versions"."template"->>'schemaVersion' = "workflow_template_versions"."schema_version");
--> statement-breakpoint
COMMENT ON TABLE "workflow_templates" IS 'Provider-neutral workflow templates. Published rows are catalog input for Workflow Creator, not executable Runtime definitions.';--> statement-breakpoint
COMMENT ON TABLE "workflow_template_versions" IS 'Immutable versioned JSONB snapshots for workflow templates.';
