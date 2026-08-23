CREATE TYPE "public"."organization_access_request_status" AS ENUM('proposed', 'approved', 'rejected', 'applied');--> statement-breakpoint
CREATE TABLE "organization_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"organization_unit_id" uuid NOT NULL,
	"requested_access" "access_level" NOT NULL,
	"reason" text NOT NULL,
	"status" "organization_access_request_status" DEFAULT 'proposed' NOT NULL,
	"reviewed_by_user_id" uuid,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "organization_access_requests" ADD CONSTRAINT "organization_access_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_access_requests" ADD CONSTRAINT "organization_access_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_access_requests" ADD CONSTRAINT "organization_access_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_access_requests" ADD CONSTRAINT "organization_access_requests_unit_scope_fk" FOREIGN KEY ("organization_unit_id","organization_id") REFERENCES "public"."organization_units"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_access_requests_id_organization_idx" ON "organization_access_requests" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "organization_access_requests_organization_status_created_idx" ON "organization_access_requests" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "organization_access_requests_requester_status_idx" ON "organization_access_requests" USING btree ("requested_by_user_id","status");--> statement-breakpoint
ALTER TABLE "organization_access_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY organization_access_requests_tenant_isolation ON "organization_access_requests"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());
