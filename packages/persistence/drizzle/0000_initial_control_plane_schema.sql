-- Consolidated control-plane schema. Keep runtime schema changes here until the first production baseline.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_gateway') THEN
    CREATE ROLE api_gateway
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      INHERIT
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$$;

--> statement-breakpoint

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO api_gateway;

--> statement-breakpoint

CREATE TYPE "public"."organization_invite_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');

--> statement-breakpoint

CREATE TYPE "public"."waitlist_request_status" AS ENUM('pending', 'contacted', 'converted', 'rejected');

--> statement-breakpoint

CREATE TYPE "public"."workflow_blueprint_status" AS ENUM('draft', 'approved', 'retired');

--> statement-breakpoint

CREATE TYPE "public"."coordinator_event_outbox_status" AS ENUM('pending', 'delivering', 'delivered', 'failed');

--> statement-breakpoint

CREATE TYPE "public"."workflow_command_receipt_status" AS ENUM('in_flight', 'accepted', 'failed');

--> statement-breakpoint

CREATE TYPE "public"."integration_binding_status" AS ENUM('active', 'revoked');

--> statement-breakpoint

CREATE TYPE "public"."integration_status" AS ENUM('pending', 'active', 'disabled', 'error');

--> statement-breakpoint

CREATE TYPE "public"."access_level" AS ENUM('viewer', 'contributor', 'manager', 'admin');

--> statement-breakpoint

CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended');

--> statement-breakpoint

CREATE TYPE "public"."organization_unit_type" AS ENUM('organization', 'department', 'team', 'project', 'service', 'custom');

--> statement-breakpoint

CREATE TYPE "public"."workflow_template_status" AS ENUM('draft', 'published', 'disabled', 'retired');

--> statement-breakpoint

CREATE TYPE "public"."workflow_template_version_status" AS ENUM('draft', 'published', 'retired');

--> statement-breakpoint

CREATE TYPE "public"."knowledge_source_kind" AS ENUM('integration', 'uploaded_document', 'manual', 'media');

--> statement-breakpoint

CREATE TYPE "public"."knowledge_source_status" AS ENUM('draft', 'connecting', 'discovering', 'ingesting', 'active', 'degraded', 'needs_reauth', 'failed', 'disabled');

--> statement-breakpoint

CREATE TYPE "public"."source_ingestion_status" AS ENUM('queued', 'running', 'completed', 'deferred', 'failed');

--> statement-breakpoint

CREATE TYPE "public"."source_ingestion_trigger" AS ENUM('bootstrap', 'manual', 'webhook', 'schedule', 'reconcile');

--> statement-breakpoint

CREATE TYPE "public"."source_revision_status" AS ENUM('pending', 'ingesting', 'active', 'failed', 'superseded');

--> statement-breakpoint

CREATE TYPE "public"."workflow_definition_status" AS ENUM('draft', 'approved', 'disabled', 'retired');

--> statement-breakpoint

CREATE TYPE "public"."workflow_plan_status" AS ENUM('proposed', 'approved', 'rejected', 'applied', 'expired');

--> statement-breakpoint

CREATE TYPE "public"."workflow_run_status" AS ENUM('queued', 'running', 'waiting', 'partial', 'failed', 'completed', 'cancelled');

--> statement-breakpoint

CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

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
);

--> statement-breakpoint

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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_requests_company_reference_check" CHECK (NULLIF(TRIM("waitlist_requests"."company_website"), '') IS NOT NULL OR NULLIF(TRIM("waitlist_requests"."company_linkedin_url"), '') IS NOT NULL)
);

--> statement-breakpoint

CREATE TABLE "workflow_blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"blueprint_id" text NOT NULL,
	"version" text NOT NULL,
	"workflow_type" text NOT NULL,
	"name" text NOT NULL,
	"blueprint" jsonb NOT NULL,
	"status" "workflow_blueprint_status" DEFAULT 'draft' NOT NULL,
	"source_plan_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);

--> statement-breakpoint

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
	"lease_until" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

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

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_provider" text DEFAULT 'identity-platform' NOT NULL,
	"identity_subject" text NOT NULL,
	"email" text,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "integration_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"organization_unit_id" uuid NOT NULL,
	"status" "integration_binding_status" DEFAULT 'active' NOT NULL,
	"granted_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"granted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);

--> statement-breakpoint

CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "integration_status" DEFAULT 'pending' NOT NULL,
	"credential_ref" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"payload_ref" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);

--> statement-breakpoint

CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"endpoint_key" text NOT NULL,
	"secret_ref" text,
	"status" "integration_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "membership_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"organization_unit_id" uuid NOT NULL,
	"access" "access_level" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "organization_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"parent_id" uuid,
	"type" "organization_unit_type" NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL
);

--> statement-breakpoint

CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "workflow_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"workflow_template_id" uuid NOT NULL,
	"version" text NOT NULL,
	"schema_version" text NOT NULL,
	"template" jsonb NOT NULL,
	"status" "workflow_template_version_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_template_versions_template_version_check" CHECK ("workflow_template_versions"."template"->>'version' = "workflow_template_versions"."version" AND "workflow_template_versions"."template"->>'schemaVersion' = "workflow_template_versions"."schema_version")
);

--> statement-breakpoint

CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"key" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"required_capabilities" text[] DEFAULT '{}' NOT NULL,
	"published_version" text,
	"status" "workflow_template_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "knowledge_source_kind" NOT NULL,
	"provider" text,
	"integration_id" uuid,
	"status" "knowledge_source_status" DEFAULT 'draft' NOT NULL,
	"read_scope" jsonb NOT NULL,
	"visibility_scope" jsonb NOT NULL,
	"content_type" text,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "source_ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_revision_id" uuid NOT NULL,
	"temporal_workflow_id" text NOT NULL,
	"temporal_run_id" text,
	"trigger" "source_ingestion_trigger" NOT NULL,
	"status" "source_ingestion_status" DEFAULT 'queued' NOT NULL,
	"current_stage" text,
	"facts_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "source_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"status" "source_revision_status" DEFAULT 'pending' NOT NULL,
	"artifact_ref" text,
	"source_object_id" text,
	"content_type" text,
	"checksum" text,
	"observed_at" timestamp with time zone,
	"ingested_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"resource_type" text,
	"resource_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "workflow_change_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"coordinator_id" text NOT NULL,
	"project_id" text,
	"plan_hash" text NOT NULL,
	"plan" jsonb NOT NULL,
	"status" "workflow_plan_status" DEFAULT 'proposed' NOT NULL,
	"approval_required" boolean DEFAULT true NOT NULL,
	"submitted_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone
);

--> statement-breakpoint

CREATE TABLE "workflow_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"key" text NOT NULL,
	"version" text NOT NULL,
	"status" "workflow_definition_status" DEFAULT 'draft' NOT NULL,
	"input_schema_ref" text,
	"output_schema_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "workflow_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"activity_name" text,
	"agent_run_id" text,
	"evidence_ref" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"temporal_namespace" text,
	"temporal_task_queue" text,
	"temporal_workflow_id" text NOT NULL,
	"temporal_run_id" text,
	"status" "workflow_run_status" DEFAULT 'queued' NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_ref" text,
	"result_ref" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE INDEX "organization_invites_email_status_idx" ON "organization_invites" USING btree ("email_normalized","status");

--> statement-breakpoint

CREATE UNIQUE INDEX "organization_invites_pending_email_idx" ON "organization_invites" USING btree ("organization_id","email_normalized") WHERE status = 'pending';

--> statement-breakpoint

CREATE UNIQUE INDEX "organization_invites_id_organization_idx" ON "organization_invites" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "waitlist_requests_email_idx" ON "waitlist_requests" USING btree ("email_normalized");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_blueprints_organization_identity_idx" ON "workflow_blueprints" USING btree ("organization_id","blueprint_id","version");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_blueprints_id_organization_idx" ON "workflow_blueprints" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "coordinator_event_outbox_organization_event_idx" ON "coordinator_event_outbox" USING btree ("organization_id","event_id");

--> statement-breakpoint

CREATE INDEX "coordinator_event_outbox_delivery_idx" ON "coordinator_event_outbox" USING btree ("status","available_at");

--> statement-breakpoint

CREATE UNIQUE INDEX "coordinator_event_outbox_id_organization_idx" ON "coordinator_event_outbox" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_command_receipts_scope_key_idx" ON "workflow_command_receipts" USING btree ("organization_id","temporal_workflow_id","command_type","command_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_command_receipts_id_organization_idx" ON "workflow_command_receipts" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "users_identity_provider_subject_idx" ON "users" USING btree ("identity_provider","identity_subject");

--> statement-breakpoint

CREATE UNIQUE INDEX "integration_bindings_unique_idx" ON "integration_bindings" USING btree ("integration_id","organization_unit_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "integrations_id_organization_id_idx" ON "integrations" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "webhook_deliveries_endpoint_event_idx" ON "webhook_deliveries" USING btree ("endpoint_id","provider_event_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "webhook_endpoints_organization_key_idx" ON "webhook_endpoints" USING btree ("organization_id","endpoint_key");

--> statement-breakpoint

CREATE UNIQUE INDEX "membership_scopes_unique_idx" ON "membership_scopes" USING btree ("membership_id","organization_unit_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "organization_memberships_organization_user_idx" ON "organization_memberships" USING btree ("organization_id","user_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "organization_memberships_id_organization_idx" ON "organization_memberships" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "organization_units_id_organization_id_idx" ON "organization_units" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "organization_units_slug_idx" ON "organization_units" USING btree ("organization_id","parent_id","slug");

--> statement-breakpoint

CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");

--> statement-breakpoint

CREATE UNIQUE INDEX "role_permissions_role_permission_idx" ON "role_permissions" USING btree ("role_id","permission");

--> statement-breakpoint

CREATE UNIQUE INDEX "roles_organization_key_idx" ON "roles" USING btree ("organization_id","key");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_template_versions_identity_idx" ON "workflow_template_versions" USING btree ("workflow_template_id","version");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_template_versions_id_idx" ON "workflow_template_versions" USING btree ("id");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_templates_scope_key_idx" ON "workflow_templates" USING btree ("organization_id","key");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_templates_id_organization_idx" ON "workflow_templates" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "knowledge_sources_id_organization_idx" ON "knowledge_sources" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "knowledge_sources_name_organization_idx" ON "knowledge_sources" USING btree ("organization_id","name");

--> statement-breakpoint

CREATE UNIQUE INDEX "source_ingestion_runs_id_organization_idx" ON "source_ingestion_runs" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "source_ingestion_runs_temporal_id_idx" ON "source_ingestion_runs" USING btree ("organization_id","temporal_workflow_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "source_revisions_source_revision_idx" ON "source_revisions" USING btree ("source_id","revision");

--> statement-breakpoint

CREATE UNIQUE INDEX "source_revisions_id_organization_idx" ON "source_revisions" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "idempotency_keys_organization_key_idx" ON "idempotency_keys" USING btree ("organization_id","key");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_change_plans_organization_plan_idx" ON "workflow_change_plans" USING btree ("organization_id","plan_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_change_plans_id_organization_idx" ON "workflow_change_plans" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_definitions_key_version_idx" ON "workflow_definitions" USING btree ("organization_id","key","version");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_events_id_organization_idx" ON "workflow_events" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_runs_organization_temporal_id_idx" ON "workflow_runs" USING btree ("organization_id","temporal_workflow_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_runs_id_organization_idx" ON "workflow_runs" USING btree ("id","organization_id");

--> statement-breakpoint

ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_unit_scope_fk" FOREIGN KEY ("organization_unit_id","organization_id") REFERENCES "public"."organization_units"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_blueprints" ADD CONSTRAINT "workflow_blueprints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "coordinator_event_outbox" ADD CONSTRAINT "coordinator_event_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_command_receipts" ADD CONSTRAINT "workflow_command_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_command_receipts" ADD CONSTRAINT "workflow_command_receipts_run_scope_fk" FOREIGN KEY ("workflow_run_id","organization_id") REFERENCES "public"."workflow_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "integration_bindings" ADD CONSTRAINT "integration_bindings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "integration_bindings" ADD CONSTRAINT "integration_bindings_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "integration_bindings" ADD CONSTRAINT "integration_bindings_integration_scope_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."integrations"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "integration_bindings" ADD CONSTRAINT "integration_bindings_unit_scope_fk" FOREIGN KEY ("organization_unit_id","organization_id") REFERENCES "public"."organization_units"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "integrations" ADD CONSTRAINT "integrations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "membership_scopes" ADD CONSTRAINT "membership_scopes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "membership_scopes" ADD CONSTRAINT "membership_scopes_membership_scope_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "public"."organization_memberships"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "membership_scopes" ADD CONSTRAINT "membership_scopes_unit_scope_fk" FOREIGN KEY ("organization_unit_id","organization_id") REFERENCES "public"."organization_units"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_parent_scope_fk" FOREIGN KEY ("parent_id","organization_id") REFERENCES "public"."organization_units"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_template_versions" ADD CONSTRAINT "workflow_template_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_template_versions" ADD CONSTRAINT "workflow_template_versions_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_integration_scope_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."integrations"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "source_ingestion_runs" ADD CONSTRAINT "source_ingestion_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "source_ingestion_runs" ADD CONSTRAINT "source_ingestion_runs_source_scope_fk" FOREIGN KEY ("source_id","organization_id") REFERENCES "public"."knowledge_sources"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "source_ingestion_runs" ADD CONSTRAINT "source_ingestion_runs_revision_scope_fk" FOREIGN KEY ("source_revision_id","organization_id") REFERENCES "public"."source_revisions"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "source_revisions" ADD CONSTRAINT "source_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "source_revisions" ADD CONSTRAINT "source_revisions_source_scope_fk" FOREIGN KEY ("source_id","organization_id") REFERENCES "public"."knowledge_sources"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_change_plans" ADD CONSTRAINT "workflow_change_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_change_plans" ADD CONSTRAINT "workflow_change_plans_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_change_plans" ADD CONSTRAINT "workflow_change_plans_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_run_scope_fk" FOREIGN KEY ("workflow_run_id","organization_id") REFERENCES "public"."workflow_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

--> statement-breakpoint

REVOKE ALL ON FUNCTION public.current_organization_id() FROM PUBLIC;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.current_organization_id() TO api_gateway;

--> statement-breakpoint

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "organization_units" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "organization_memberships" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "membership_scopes" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "integration_bindings" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "workflow_definitions" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "workflow_runs" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "workflow_events" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "workflow_change_plans" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "workflow_blueprints" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "coordinator_event_outbox" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "workflow_command_receipts" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "workflow_templates" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "workflow_template_versions" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "knowledge_sources" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "source_revisions" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "source_ingestion_runs" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

CREATE POLICY organizations_tenant_isolation ON "organizations"
  USING (id = public.current_organization_id())
  WITH CHECK (id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY organization_units_tenant_isolation ON "organization_units"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY roles_tenant_isolation ON "roles"
  USING (organization_id IS NULL OR organization_id = public.current_organization_id())
  WITH CHECK (organization_id IS NULL OR organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY role_permissions_tenant_isolation ON "role_permissions"
  USING (EXISTS (
    SELECT 1 FROM "roles"
    WHERE "roles"."id" = "role_permissions"."role_id"
      AND ("roles"."organization_id" IS NULL OR "roles"."organization_id" = public.current_organization_id())
  ));

--> statement-breakpoint

CREATE POLICY organization_memberships_tenant_isolation ON "organization_memberships"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY membership_scopes_tenant_isolation ON "membership_scopes"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY integrations_tenant_isolation ON "integrations"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY integration_bindings_tenant_isolation ON "integration_bindings"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY webhook_endpoints_tenant_isolation ON "webhook_endpoints"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY webhook_deliveries_tenant_isolation ON "webhook_deliveries"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY workflow_definitions_tenant_isolation ON "workflow_definitions"
  USING (organization_id IS NULL OR organization_id = public.current_organization_id())
  WITH CHECK (organization_id IS NULL OR organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY workflow_runs_tenant_isolation ON "workflow_runs"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY workflow_events_tenant_isolation ON "workflow_events"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY idempotency_keys_tenant_isolation ON "idempotency_keys"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY audit_events_tenant_isolation ON "audit_events"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY workflow_change_plans_tenant_isolation ON "workflow_change_plans"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY workflow_blueprints_tenant_isolation ON "workflow_blueprints"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY coordinator_event_outbox_tenant_isolation ON "coordinator_event_outbox"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY workflow_command_receipts_tenant_isolation ON "workflow_command_receipts"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY workflow_templates_tenant_isolation ON "workflow_templates"
  USING (organization_id IS NULL OR organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY workflow_template_versions_tenant_isolation ON "workflow_template_versions"
  USING (
    (workflow_template_versions.organization_id IS NULL OR workflow_template_versions.organization_id = public.current_organization_id())
    AND EXISTS (
      SELECT 1
      FROM public.workflow_templates AS templates
      WHERE templates.id = workflow_template_versions.workflow_template_id
        AND templates.organization_id IS NOT DISTINCT FROM workflow_template_versions.organization_id
    )
  )
  WITH CHECK (
    workflow_template_versions.organization_id = public.current_organization_id()
    AND EXISTS (
      SELECT 1
      FROM public.workflow_templates AS templates
      WHERE templates.id = workflow_template_versions.workflow_template_id
        AND templates.organization_id IS NOT DISTINCT FROM workflow_template_versions.organization_id
    )
  );

--> statement-breakpoint

CREATE POLICY knowledge_sources_tenant_isolation ON "knowledge_sources"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY source_revisions_tenant_isolation ON "source_revisions"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE POLICY source_ingestion_runs_tenant_isolation ON "source_ingestion_runs"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO api_gateway;

--> statement-breakpoint

GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO api_gateway;

--> statement-breakpoint

REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM api_gateway;

--> statement-breakpoint

GRANT DELETE ON "membership_scopes" TO api_gateway;

--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "workflow_templates" FROM api_gateway;

--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "workflow_template_versions" FROM api_gateway;

--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO api_gateway;

--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO api_gateway;

--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM api_gateway;

--> statement-breakpoint

DO $$
BEGIN
  IF to_regclass('public.__drizzle_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.__drizzle_migrations FROM api_gateway;
  END IF;
END
$$;

--> statement-breakpoint

ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "blueprint_id" text;

--> statement-breakpoint

ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "blueprint_version" text;

--> statement-breakpoint

ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "parent_workflow_id" text;

--> statement-breakpoint

ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "trigger" text;

--> statement-breakpoint

ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "business_input" jsonb DEFAULT '{}'::jsonb NOT NULL;

--> statement-breakpoint

ALTER TYPE "integration_status" ADD VALUE IF NOT EXISTS 'authorized';
ALTER TYPE "integration_status" ADD VALUE IF NOT EXISTS 'degraded';
ALTER TYPE "integration_status" ADD VALUE IF NOT EXISTS 'needs_reauth';

ALTER TABLE "integrations"
  ADD COLUMN IF NOT EXISTS "authorized_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_health_check_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_error" text;

--> statement-breakpoint

ALTER TYPE "workflow_run_status" ADD VALUE IF NOT EXISTS 'paused';

--> statement-breakpoint

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

--> statement-breakpoint

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

--> statement-breakpoint

ALTER TABLE "workflow_change_plans" ADD COLUMN IF NOT EXISTS "planner_name" text;
ALTER TABLE "workflow_change_plans" ADD COLUMN IF NOT EXISTS "planner_version" text;
ALTER TABLE "workflow_change_plans" ADD COLUMN IF NOT EXISTS "source_schema_version" text;
ALTER TABLE "workflow_change_plans" ADD COLUMN IF NOT EXISTS "prompt_version" text;
ALTER TABLE "workflow_change_plans" ADD COLUMN IF NOT EXISTS "prompt_hash" text;
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "retention_until" timestamptz;

-- Existing terminal runs predate the retention column. Backfill them with the
-- default control-plane retention window so they enter the same cleanup path.
UPDATE "workflow_runs"
SET "retention_until" = "created_at" + interval '30 days'
WHERE "retention_until" IS NULL
  AND "status" IN ('completed', 'failed', 'partial', 'cancelled');

COMMENT ON COLUMN "workflow_change_plans"."prompt_hash" IS 'Non-reversible hash of the user planner input; raw prompts are not persisted here.';
COMMENT ON COLUMN "workflow_runs"."retention_until" IS 'Retention deadline for the run record and its workflow-event/evidence linkage.';

--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_gateway_retention') THEN
    CREATE ROLE api_gateway_retention
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      INHERIT
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO api_gateway_retention;
GRANT EXECUTE ON FUNCTION public.current_organization_id() TO api_gateway_retention;
GRANT SELECT, DELETE ON "workflow_command_receipts", "workflow_events", "workflow_runs" TO api_gateway_retention;
GRANT SELECT, INSERT ON "audit_events" TO api_gateway_retention;

--> statement-breakpoint

ALTER TABLE "webhook_endpoints" ADD COLUMN "integration_id" uuid;

--> statement-breakpoint

ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_integration_scope_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."integrations"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "webhook_deliveries" ADD COLUMN "payload_checksum" text;

--> statement-breakpoint

ALTER TABLE "workflow_blueprints" ADD COLUMN "is_current" boolean DEFAULT false NOT NULL;

--> statement-breakpoint

WITH ranked_approved AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "organization_id", "blueprint_id"
    ORDER BY "updated_at" DESC, "version" DESC
  ) AS "rank"
  FROM "workflow_blueprints"
  WHERE "status" = 'approved'
)
UPDATE "workflow_blueprints" AS blueprint
SET "is_current" = true
FROM ranked_approved
WHERE blueprint."id" = ranked_approved."id"
  AND ranked_approved."rank" = 1;

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_blueprints_current_idx" ON "workflow_blueprints" USING btree ("organization_id","blueprint_id") WHERE is_current = true;

--> statement-breakpoint

ALTER TABLE "workflow_blueprints" ADD CONSTRAINT "workflow_blueprints_current_approved_check" CHECK (NOT "workflow_blueprints"."is_current" OR "workflow_blueprints"."status" = 'approved');

--> statement-breakpoint

CREATE TYPE "public"."memory_change_action" AS ENUM('correct', 'delete');

--> statement-breakpoint

CREATE TYPE "public"."memory_change_status" AS ENUM('proposed', 'approved', 'rejected', 'applied', 'failed');

--> statement-breakpoint

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

ALTER TABLE "memory_change_requests" ADD CONSTRAINT "memory_change_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "memory_change_requests" ADD CONSTRAINT "memory_change_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "memory_change_requests" ADD CONSTRAINT "memory_change_requests_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

CREATE UNIQUE INDEX "memory_change_requests_id_organization_idx" ON "memory_change_requests" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE INDEX "memory_change_requests_organization_created_idx" ON "memory_change_requests" USING btree ("organization_id","created_at");

--> statement-breakpoint

ALTER TABLE "memory_change_requests" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

CREATE POLICY memory_change_requests_tenant_isolation ON "memory_change_requests"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE TYPE "public"."organization_access_request_status" AS ENUM('proposed', 'approved', 'rejected', 'applied');

--> statement-breakpoint

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

ALTER TABLE "organization_access_requests" ADD CONSTRAINT "organization_access_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "organization_access_requests" ADD CONSTRAINT "organization_access_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "organization_access_requests" ADD CONSTRAINT "organization_access_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "organization_access_requests" ADD CONSTRAINT "organization_access_requests_unit_scope_fk" FOREIGN KEY ("organization_unit_id","organization_id") REFERENCES "public"."organization_units"("id","organization_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

CREATE UNIQUE INDEX "organization_access_requests_id_organization_idx" ON "organization_access_requests" USING btree ("id","organization_id");

--> statement-breakpoint

CREATE INDEX "organization_access_requests_organization_status_created_idx" ON "organization_access_requests" USING btree ("organization_id","status","created_at");

--> statement-breakpoint

CREATE INDEX "organization_access_requests_requester_status_idx" ON "organization_access_requests" USING btree ("requested_by_user_id","status");

--> statement-breakpoint

ALTER TABLE "organization_access_requests" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

CREATE POLICY organization_access_requests_tenant_isolation ON "organization_access_requests"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

ALTER TYPE "public"."memory_change_action" ADD VALUE 'add' BEFORE 'correct';

--> statement-breakpoint

ALTER TABLE "memory_change_requests" ALTER COLUMN "memory_id" DROP NOT NULL;

--> statement-breakpoint

ALTER TABLE "memory_change_requests" ADD COLUMN "evidence_refs" jsonb;

--> statement-breakpoint

CREATE TYPE "public"."recommendation_severity" AS ENUM('info', 'attention');

--> statement-breakpoint

CREATE TYPE "public"."recommendation_status" AS ENUM('open', 'accepted', 'dismissed', 'resolved');

--> statement-breakpoint

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

ALTER TABLE "coordinator_recommendations" ADD CONSTRAINT "coordinator_recommendations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "coordinator_recommendations" ADD CONSTRAINT "coordinator_recommendations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

CREATE UNIQUE INDEX "coordinator_recommendations_user_key_idx" ON "coordinator_recommendations" USING btree ("organization_id","user_id","recommendation_key");

--> statement-breakpoint

CREATE INDEX "coordinator_recommendations_user_status_idx" ON "coordinator_recommendations" USING btree ("organization_id","user_id","status","updated_at");

--> statement-breakpoint

CREATE UNIQUE INDEX "coordinator_recommendations_id_organization_idx" ON "coordinator_recommendations" USING btree ("id","organization_id");

--> statement-breakpoint

ALTER TABLE "coordinator_recommendations" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

CREATE POLICY coordinator_recommendations_tenant_isolation ON "coordinator_recommendations"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE TABLE "workflow_planner_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"planner_name" text,
	"planner_version" text,
	"source_schema_version" text,
	"prompt_version" text,
	"prompt_hash" text,
	"version_hash" text NOT NULL,
	"first_plan_id" text NOT NULL,
	"last_plan_id" text NOT NULL,
	"usage_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

ALTER TABLE "workflow_planner_versions" ADD CONSTRAINT "workflow_planner_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_planner_versions_org_hash_idx" ON "workflow_planner_versions" USING btree ("organization_id","version_hash");

--> statement-breakpoint

CREATE INDEX "workflow_planner_versions_org_last_seen_idx" ON "workflow_planner_versions" USING btree ("organization_id","last_seen_at");

--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_planner_versions_id_organization_idx" ON "workflow_planner_versions" USING btree ("id","organization_id");

--> statement-breakpoint

ALTER TABLE "workflow_planner_versions" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

CREATE POLICY workflow_planner_versions_tenant_isolation ON "workflow_planner_versions"
  USING (organization_id = public.current_organization_id())
  WITH CHECK (organization_id = public.current_organization_id());

--> statement-breakpoint

CREATE TYPE "public"."coordination_mode" AS ENUM('start-coordinator', 'connect-only');

--> statement-breakpoint

CREATE TYPE "public"."organization_onboarding_status" AS ENUM('pending', 'initializing', 'ready', 'failed');

--> statement-breakpoint

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
