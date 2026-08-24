ALTER TABLE "workflow_blueprints" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_change_plans" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "workflow_blueprints_organization_deleted_idx" ON "workflow_blueprints" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE INDEX "workflow_change_plans_organization_deleted_idx" ON "workflow_change_plans" USING btree ("organization_id","deleted_at");