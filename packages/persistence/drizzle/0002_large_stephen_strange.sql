CREATE TYPE "public"."workflow_blueprint_status" AS ENUM('draft', 'approved', 'retired');--> statement-breakpoint
CREATE TABLE "workflow_blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"blueprint_id" text NOT NULL,
	"version" text NOT NULL,
	"workflow_type" text NOT NULL,
	"name" text NOT NULL,
	"blueprint" jsonb NOT NULL,
	"status" "workflow_blueprint_status" DEFAULT 'draft' NOT NULL,
	"source_plan_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workflow_blueprints" ADD CONSTRAINT "workflow_blueprints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_blueprints_organization_identity_idx" ON "workflow_blueprints" USING btree ("organization_id","blueprint_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_blueprints_id_organization_idx" ON "workflow_blueprints" USING btree ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "workflow_blueprints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workflow_blueprints_tenant_isolation ON "workflow_blueprints"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "workflow_blueprints" TO api_gateway;--> statement-breakpoint
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "workflow_blueprints" FROM api_gateway;
