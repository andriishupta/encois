CREATE TYPE "public"."organization_invite_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."waitlist_request_status" AS ENUM('pending', 'contacted', 'converted', 'rejected');--> statement-breakpoint
CREATE TABLE "organization_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_normalized" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"organization_unit_id" uuid,
	"role_id" uuid NOT NULL,
	"status" "organization_invite_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"invited_by_user_id" uuid,
	"accepted_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "waitlist_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_normalized" text NOT NULL,
	"display_name" text,
	"company_name" text NOT NULL,
	"company_website" text,
	"company_linkedin_url" text,
	"message" text,
	"status" "waitlist_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contacted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_unit_scope_fk" FOREIGN KEY ("organization_unit_id","organization_id") REFERENCES "public"."organization_units"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_invites_email_status_idx" ON "organization_invites" USING btree ("email_normalized","status");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invites_pending_email_idx" ON "organization_invites" USING btree ("organization_id","email_normalized") WHERE "status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invites_id_organization_idx" ON "organization_invites" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_requests_email_idx" ON "waitlist_requests" USING btree ("email_normalized");--> statement-breakpoint
ALTER TABLE "waitlist_requests" ADD CONSTRAINT "waitlist_requests_company_reference_check" CHECK (NULLIF(TRIM("company_website"), '') IS NOT NULL OR NULLIF(TRIM("company_linkedin_url"), '') IS NOT NULL);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "organization_invites" TO api_gateway;--> statement-breakpoint
GRANT INSERT, SELECT, UPDATE ON "waitlist_requests" TO api_gateway;--> statement-breakpoint
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "organization_invites" FROM api_gateway;--> statement-breakpoint
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "waitlist_requests" FROM api_gateway;
