CREATE TYPE "public"."recommendation_severity" AS ENUM('info', 'attention');--> statement-breakpoint
CREATE TYPE "public"."recommendation_status" AS ENUM('open', 'accepted', 'dismissed', 'resolved');--> statement-breakpoint
CREATE TABLE "coordinator_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"recommendation_key" text NOT NULL,
	"kind" text NOT NULL,
	"severity" "recommendation_severity" DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"target" text NOT NULL,
	"action_label" text NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "recommendation_status" DEFAULT 'open' NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "coordinator_recommendations" ADD CONSTRAINT "coordinator_recommendations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_recommendations" ADD CONSTRAINT "coordinator_recommendations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_recommendations_user_key_idx" ON "coordinator_recommendations" USING btree ("organization_id","user_id","recommendation_key");--> statement-breakpoint
CREATE INDEX "coordinator_recommendations_user_status_idx" ON "coordinator_recommendations" USING btree ("organization_id","user_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_recommendations_id_organization_idx" ON "coordinator_recommendations" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "coordinator_recommendations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY coordinator_recommendations_tenant_isolation ON "coordinator_recommendations"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());
