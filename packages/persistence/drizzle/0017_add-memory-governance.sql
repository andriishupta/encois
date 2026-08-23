ALTER TYPE "public"."memory_change_action" ADD VALUE 'add' BEFORE 'correct';--> statement-breakpoint
ALTER TABLE "memory_change_requests" ALTER COLUMN "memory_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_change_requests" ADD COLUMN "evidence_refs" jsonb;