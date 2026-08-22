CREATE UNIQUE INDEX "workflow_blueprints_current_idx" ON "workflow_blueprints" USING btree ("organization_id","blueprint_id") WHERE is_current = true;--> statement-breakpoint
ALTER TABLE "workflow_blueprints" ADD CONSTRAINT "workflow_blueprints_current_approved_check" CHECK (NOT "workflow_blueprints"."is_current" OR "workflow_blueprints"."status" = 'approved');
