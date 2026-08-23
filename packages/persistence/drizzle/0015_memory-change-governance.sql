CREATE TYPE "public"."memory_change_action" AS ENUM('correct', 'delete');--> statement-breakpoint
CREATE TYPE "public"."memory_change_status" AS ENUM('proposed', 'approved', 'rejected', 'applied', 'failed');--> statement-breakpoint
CREATE TABLE "memory_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"memory_id" text NOT NULL,
	"agent_definition" text NOT NULL,
	"project_id" text,
	"user_id" text,
	"scope" jsonb NOT NULL,
	"action" "memory_change_action" NOT NULL,
	"replacement_summary" text,
	"status" "memory_change_status" DEFAULT 'proposed' NOT NULL,
	"requested_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"runtime_request_id" text,
	"provider_operation_name" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "memory_change_requests" ADD CONSTRAINT "memory_change_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_change_requests" ADD CONSTRAINT "memory_change_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_change_requests" ADD CONSTRAINT "memory_change_requests_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_change_requests_id_organization_idx" ON "memory_change_requests" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "memory_change_requests_organization_created_idx" ON "memory_change_requests" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "memory_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY memory_change_requests_tenant_isolation ON "memory_change_requests"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "roles"."id", 'memory:manage'
FROM "roles"
WHERE "roles"."organization_id" IS NULL AND "roles"."key" = 'organization_admin'
ON CONFLICT ("role_id", "permission") DO NOTHING;
