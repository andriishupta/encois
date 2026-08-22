ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "blueprint_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "blueprint_version" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "parent_workflow_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "trigger" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "business_input" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
