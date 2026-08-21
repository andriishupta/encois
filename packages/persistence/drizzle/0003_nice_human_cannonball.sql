CREATE TYPE "public"."coordinator_event_outbox_status" AS ENUM('pending', 'delivering', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "coordinator_event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"coordinator_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "coordinator_event_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coordinator_event_outbox" ADD CONSTRAINT "coordinator_event_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_event_outbox_organization_event_idx" ON "coordinator_event_outbox" USING btree ("organization_id","event_id");--> statement-breakpoint
CREATE INDEX "coordinator_event_outbox_delivery_idx" ON "coordinator_event_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_event_outbox_id_organization_idx" ON "coordinator_event_outbox" USING btree ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "coordinator_event_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY coordinator_event_outbox_tenant_isolation ON "coordinator_event_outbox"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "coordinator_event_outbox" TO api_gateway;--> statement-breakpoint
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "coordinator_event_outbox" FROM api_gateway;
