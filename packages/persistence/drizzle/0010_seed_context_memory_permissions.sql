INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "roles"."id", permissions.permission
FROM "roles"
JOIN (VALUES
  ('organization_admin', 'context:read'),
  ('organization_admin', 'memory:read')
) AS permissions(role_key, permission) ON permissions.role_key = "roles"."key"
WHERE "roles"."organization_id" IS NULL
ON CONFLICT ("role_id", "permission") DO NOTHING;
