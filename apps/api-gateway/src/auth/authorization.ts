import {
  isPermission,
  type PermissionKey,
  permissionIncludes,
} from "@encois/contracts";
import {
  organizationMemberships,
  type PersistenceDatabase,
  type PersistenceTransaction,
  rolePermissions,
  roles,
} from "@encois/persistence";
import { and, eq } from "drizzle-orm";
import type { AosPrincipal } from "../middleware/aos.js";

type QueryDatabase = PersistenceDatabase | PersistenceTransaction;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function localUserId(principal: AosPrincipal): string | null {
  const candidate = principal.userId ?? principal.actorId;
  return uuidPattern.test(candidate) ? candidate : null;
}

export async function getGrantedPermissions(
  db: QueryDatabase,
  principal: AosPrincipal,
): Promise<readonly PermissionKey[]> {
  const userId = localUserId(principal);
  if (!userId) return [];

  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(organizationMemberships)
    .innerJoin(
      rolePermissions,
      eq(rolePermissions.roleId, organizationMemberships.roleId),
    )
    .where(
      and(
        eq(organizationMemberships.organizationId, principal.organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, "active"),
      ),
    );

  return rows.map(({ permission }) => permission).filter(isPermission);
}

export async function hasPermission(
  db: QueryDatabase,
  principal: AosPrincipal,
  required: PermissionKey,
): Promise<boolean> {
  return permissionIncludes(
    await getGrantedPermissions(db, principal),
    required,
  );
}

export async function hasPermissions(
  db: QueryDatabase,
  principal: AosPrincipal,
  required: readonly PermissionKey[],
): Promise<boolean> {
  if (required.length === 0) return true;
  const granted = await getGrantedPermissions(db, principal);
  return required.every((permission) =>
    permissionIncludes(granted, permission),
  );
}

export async function hasAnyPermission(
  db: QueryDatabase,
  principal: AosPrincipal,
  required: readonly PermissionKey[],
): Promise<boolean> {
  if (required.length === 0) return false;
  const granted = await getGrantedPermissions(db, principal);
  return required.some((permission) => permissionIncludes(granted, permission));
}

export function isOrganizationAdministratorRole(roleKey: string): boolean {
  return roleKey === "organization_admin" || roleKey === "admin";
}

/**
 * Organization-wide scope is a role boundary, not a capability permission.
 * Managers intentionally receive organization:manage for actions inside their
 * assigned subtree, so that permission must never be used as a tenant-wide
 * bypass.
 */
export async function isOrganizationAdministrator(
  db: QueryDatabase,
  principal: AosPrincipal,
): Promise<boolean> {
  const userId = localUserId(principal);
  if (!userId) return false;

  const [membership] = await db
    .select({ roleKey: roles.key })
    .from(organizationMemberships)
    .innerJoin(roles, eq(roles.id, organizationMemberships.roleId))
    .where(
      and(
        eq(organizationMemberships.organizationId, principal.organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .limit(1);

  return membership
    ? isOrganizationAdministratorRole(membership.roleKey)
    : false;
}

export function hasPrincipalPermission(
  principal: AosPrincipal,
  required: PermissionKey,
): boolean {
  return permissionIncludes(principal.permissions ?? [], required);
}
