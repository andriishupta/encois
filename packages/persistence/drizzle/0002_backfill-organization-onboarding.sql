-- Every organization must have a durable onboarding row. This repairs
-- organizations created by older control-plane paths without changing their
-- existing lifecycle state.
INSERT INTO "organization_onboarding" ("organization_id", "coordinator_id")
SELECT "id", 'organization:' || "id"
FROM "organizations"
ON CONFLICT ("organization_id") DO NOTHING;
