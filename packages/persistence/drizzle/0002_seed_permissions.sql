INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "roles"."id", permissions.permission
FROM "roles"
JOIN (VALUES
  ('organization_admin', 'onboarding:manage'),
  ('organization_admin', 'organization:read'),
  ('organization_admin', 'organization:manage'),
  ('organization_admin', 'settings:read'),
  ('organization_admin', 'settings:manage'),
  ('manager', 'organization:read'),
  ('manager', 'organization:manage'),
  ('manager', 'settings:read'),
  ('member', 'organization:read'),
  ('member', 'settings:read'),
  ('viewer', 'organization:read'),
  ('viewer', 'settings:read')
) AS permissions(role_key, permission) ON permissions.role_key = "roles"."key"
WHERE "roles"."organization_id" IS NULL
ON CONFLICT ("role_id", "permission") DO NOTHING;--> statement-breakpoint
