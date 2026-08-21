CREATE TYPE "public"."workflow_plan_status" AS ENUM('proposed', 'approved', 'rejected', 'applied', 'expired');--> statement-breakpoint
CREATE TABLE "workflow_change_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"coordinator_id" text NOT NULL,
	"project_id" text,
	"plan_hash" text NOT NULL,
	"plan" jsonb NOT NULL,
	"status" "workflow_plan_status" DEFAULT 'proposed' NOT NULL,
	"approval_required" boolean DEFAULT true NOT NULL,
	"submitted_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workflow_change_plans" ADD CONSTRAINT "workflow_change_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_change_plans" ADD CONSTRAINT "workflow_change_plans_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_change_plans" ADD CONSTRAINT "workflow_change_plans_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_change_plans_organization_plan_idx" ON "workflow_change_plans" USING btree ("organization_id","plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_change_plans_id_organization_idx" ON "workflow_change_plans" USING btree ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "workflow_change_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workflow_change_plans_tenant_isolation ON "workflow_change_plans"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "workflow_change_plans" TO api_gateway;--> statement-breakpoint
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "workflow_change_plans" FROM api_gateway;
