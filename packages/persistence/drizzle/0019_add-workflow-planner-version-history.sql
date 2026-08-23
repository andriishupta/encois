CREATE TABLE "workflow_planner_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"planner_name" text,
	"planner_version" text,
	"source_schema_version" text,
	"prompt_version" text,
	"prompt_hash" text,
	"version_hash" text NOT NULL,
	"first_plan_id" text NOT NULL,
	"last_plan_id" text NOT NULL,
	"usage_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_planner_versions" ADD CONSTRAINT "workflow_planner_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_planner_versions_org_hash_idx" ON "workflow_planner_versions" USING btree ("organization_id","version_hash");--> statement-breakpoint
CREATE INDEX "workflow_planner_versions_org_last_seen_idx" ON "workflow_planner_versions" USING btree ("organization_id","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_planner_versions_id_organization_idx" ON "workflow_planner_versions" USING btree ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "workflow_planner_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workflow_planner_versions_tenant_isolation ON "workflow_planner_versions"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());
