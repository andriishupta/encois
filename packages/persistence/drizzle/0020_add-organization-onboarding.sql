CREATE TYPE "public"."coordination_mode" AS ENUM('start-coordinator', 'connect-only');--> statement-breakpoint
CREATE TYPE "public"."organization_onboarding_status" AS ENUM('pending', 'initializing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "organization_onboarding" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"status" "organization_onboarding_status" DEFAULT 'pending' NOT NULL,
	"coordinator_id" text NOT NULL,
	"coordination_mode" "coordination_mode" DEFAULT 'start-coordinator' NOT NULL,
	"selected_workflows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_onboarding" ADD CONSTRAINT "organization_onboarding_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_onboarding" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_onboarding_tenant_isolation ON "organization_onboarding"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());
--> statement-breakpoint
INSERT INTO "organization_onboarding" ("organization_id", "coordinator_id")
SELECT "id", 'organization:' || "id" FROM "organizations"
ON CONFLICT ("organization_id") DO NOTHING;
