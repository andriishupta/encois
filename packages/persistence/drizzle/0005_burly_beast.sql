CREATE TYPE "public"."workflow_command_receipt_status" AS ENUM('in_flight', 'accepted', 'failed');--> statement-breakpoint
CREATE TABLE "workflow_command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"temporal_workflow_id" text NOT NULL,
	"command_type" text NOT NULL,
	"command_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" "workflow_command_receipt_status" DEFAULT 'in_flight' NOT NULL,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_command_receipts" ADD CONSTRAINT "workflow_command_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_command_receipts" ADD CONSTRAINT "workflow_command_receipts_run_scope_fk" FOREIGN KEY ("workflow_run_id","organization_id") REFERENCES "public"."workflow_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_command_receipts_scope_key_idx" ON "workflow_command_receipts" USING btree ("organization_id","temporal_workflow_id","command_type","command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_command_receipts_id_organization_idx" ON "workflow_command_receipts" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "workflow_command_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workflow_command_receipts_tenant_isolation ON "workflow_command_receipts"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "workflow_command_receipts" TO api_gateway;--> statement-breakpoint
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "workflow_command_receipts" FROM api_gateway;
