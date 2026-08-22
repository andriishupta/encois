CREATE TABLE IF NOT EXISTS "integration_authorization_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "integration_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "provider" text NOT NULL,
  "state_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "integration_authorization_states_hash_idx" ON "integration_authorization_states" USING btree ("state_hash");
ALTER TABLE "integration_authorization_states" ADD CONSTRAINT "integration_authorization_states_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
ALTER TABLE "integration_authorization_states" ADD CONSTRAINT "integration_authorization_states_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null;
ALTER TABLE "integration_authorization_states" ADD CONSTRAINT "integration_authorization_states_integration_scope_fk" FOREIGN KEY ("integration_id", "organization_id") REFERENCES "public"."integrations"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "integration_authorization_states" ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_authorization_states_tenant_isolation ON "integration_authorization_states"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());
