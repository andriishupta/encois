-- Integrations are provider-level organization records. Existing deployments
-- used integration_bindings as unit-scoped access records, so collapse those
-- grants onto each organization's root unit before Sources resolve resources.
WITH roots AS (
  SELECT organization_id, id AS root_unit_id
  FROM organization_units
  WHERE type = 'organization' AND parent_id IS NULL
), integration_rows AS (
  SELECT
    binding.organization_id,
    binding.integration_id,
    roots.root_unit_id,
    CASE WHEN bool_or(binding.status = 'active') THEN 'active' ELSE 'revoked' END::integration_binding_status AS next_status,
    COALESCE(
      (
        SELECT jsonb_agg(DISTINCT scope_value ORDER BY scope_value)
        FROM integration_bindings scoped_binding
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(scoped_binding.granted_scopes, '[]'::jsonb)) AS scope(scope_value)
        WHERE scoped_binding.organization_id = binding.organization_id
          AND scoped_binding.integration_id = binding.integration_id
      ),
      '[]'::jsonb
    ) AS next_scopes,
    (array_agg(binding.granted_by_user_id) FILTER (WHERE binding.granted_by_user_id IS NOT NULL))[1] AS granted_by_user_id
  FROM integration_bindings binding
  INNER JOIN roots ON roots.organization_id = binding.organization_id
  GROUP BY binding.organization_id, binding.integration_id, roots.root_unit_id
)
INSERT INTO integration_bindings (
  organization_id,
  integration_id,
  organization_unit_id,
  status,
  granted_scopes,
  granted_by_user_id,
  revoked_at
)
SELECT
  organization_id,
  integration_id,
  root_unit_id,
  next_status,
  next_scopes,
  granted_by_user_id,
  CASE WHEN next_status = 'revoked' THEN now() ELSE NULL END
FROM integration_rows
ON CONFLICT (integration_id, organization_unit_id) DO UPDATE
SET
  status = EXCLUDED.status,
  granted_scopes = EXCLUDED.granted_scopes,
  granted_by_user_id = COALESCE(EXCLUDED.granted_by_user_id, integration_bindings.granted_by_user_id),
  revoked_at = EXCLUDED.revoked_at;

DELETE FROM integration_bindings binding
USING organization_units root
WHERE root.organization_id = binding.organization_id
  AND root.type = 'organization'
  AND root.parent_id IS NULL
  AND binding.organization_unit_id <> root.id;

--> statement-breakpoint

DELETE FROM "role_permissions" role_permission
USING "roles" role
WHERE role_permission."role_id" = role."id"
  AND role."organization_id" IS NULL
  AND role."key" = 'manager'
  AND role_permission."permission" = 'integrations:manage';

--> statement-breakpoint

COMMENT ON TABLE integration_bindings IS 'Organization-level provider capability grants. Unit-scoped provider resources are Sources in knowledge_sources.';
