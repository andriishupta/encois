import { and, eq } from "drizzle-orm";
import { isPermission, permissionIncludes, type PermissionKey } from "@encois/contracts";
import {
  organizationMemberships,
  rolePermissions,
  type PersistenceDatabase,
  type PersistenceTransaction,
} from "@encois/persistence";
import type { AosPrincipal } from "../middleware/aos.js";

type QueryDatabase = PersistenceDatabase | PersistenceTransaction;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, organizationMemberships.roleId))
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
  return permissionIncludes(await getGrantedPermissions(db, principal), required);
}

export function hasPrincipalPermission(principal: AosPrincipal, required: PermissionKey): boolean {
  return permissionIncludes(principal.permissions ?? [], required);
}
