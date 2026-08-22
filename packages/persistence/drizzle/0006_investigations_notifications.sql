CREATE TABLE IF NOT EXISTS "saved_investigations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"query" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "saved_investigations_id_organization_idx" ON "saved_investigations" USING btree ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "saved_investigations_owner_name_idx" ON "saved_investigations" USING btree ("organization_id", "owner_user_id", "name");
ALTER TABLE "saved_investigations" ADD CONSTRAINT "saved_investigations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
ALTER TABLE "saved_investigations" ADD CONSTRAINT "saved_investigations_owner_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;

CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"push_enabled" boolean DEFAULT false NOT NULL,
	"workflow_updates" boolean DEFAULT true NOT NULL,
	"evidence_ready" boolean DEFAULT true NOT NULL,
	"weekly_digest" boolean DEFAULT false NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_user_idx" ON "notification_preferences" USING btree ("organization_id", "user_id");
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;

CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_user_dedupe_idx" ON "notifications" USING btree ("organization_id", "user_id", "dedupe_key");
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_id_organization_idx" ON "notifications" USING btree ("id", "organization_id");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;

ALTER TABLE "saved_investigations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY saved_investigations_tenant_isolation ON "saved_investigations"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());
CREATE POLICY notification_preferences_tenant_isolation ON "notification_preferences"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());
CREATE POLICY notifications_tenant_isolation ON "notifications"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());
