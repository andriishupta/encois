ALTER TYPE "integration_status" ADD VALUE IF NOT EXISTS 'authorized';
ALTER TYPE "integration_status" ADD VALUE IF NOT EXISTS 'degraded';
ALTER TYPE "integration_status" ADD VALUE IF NOT EXISTS 'needs_reauth';

ALTER TABLE "integrations"
  ADD COLUMN IF NOT EXISTS "authorized_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_health_check_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_error" text;
