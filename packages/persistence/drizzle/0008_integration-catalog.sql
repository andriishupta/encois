CREATE TYPE "public"."integration_type" AS ENUM('api', 'ai', 'mcp', 'custom');--> statement-breakpoint
CREATE TYPE "public"."integration_catalog_status" AS ENUM('active', 'pending', 'disabled');--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "integration_type" "integration_type" DEFAULT 'api' NOT NULL;--> statement-breakpoint
CREATE TABLE "integration_catalog" (
	"key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"integration_type" "integration_type" NOT NULL,
	"status" "integration_catalog_status" DEFAULT 'disabled' NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_catalog_provider_type_idx" ON "integration_catalog" USING btree ("provider", "integration_type");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_catalog_status_sort_idx" ON "integration_catalog" USING btree ("status", "sort_order");
