ALTER TABLE "webhook_endpoints" ADD COLUMN "integration_id" uuid;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_integration_scope_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."integrations"("id","organization_id") ON DELETE no action ON UPDATE no action;
