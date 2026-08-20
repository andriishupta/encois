import { and, eq, inArray, or } from "drizzle-orm";
import {
  integrationBindings,
  integrations,
  membershipScopes,
  organizationMemberships,
  rolePermissions,
  type IntegrationStatus,
  type PersistenceTransaction,
  withOrganizationContext,
} from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { database } from "../../database.js";

export type IntegrationSummary = {
  id: string;
  name: string;
  status: IntegrationStatus;
  provider: string;
};

export type IntegrationUpdate = {
  displayName?: string;
  status?: IntegrationStatus;
};

type QueryDatabase = NonNullable<typeof database> | PersistenceTransaction;

function localUserId(principal: AosPrincipal): string | null {
  const candidate = principal.userId ?? principal.actorId;
  return /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null;
}

export async function listIntegrationsForPrincipal(
  principal: AosPrincipal,
): Promise<readonly IntegrationSummary[]> {
  if (!database) throw new Error("PERSISTENCE_UNAVAILABLE");

  const userId = localUserId(principal);
  if (!userId) return [];

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const rows = await accessibleIntegrations(db, principal.organizationId, userId, "read");
    return rows.map((row) => ({
      id: row.id,
      name: row.displayName,
      provider: row.provider,
      status: row.status,
    }));
  });
}

export async function updateIntegrationForPrincipal(
  principal: AosPrincipal,
  integrationId: string,
  update: IntegrationUpdate,
): Promise<IntegrationSummary | null> {
  if (!database) throw new Error("PERSISTENCE_UNAVAILABLE");

  const userId = localUserId(principal);
  if (!userId) return null;

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const accessible = await accessibleIntegrations(
      db,
      principal.organizationId,
      userId,
      "manage",
      integrationId,
    );
    if (accessible.length === 0) return null;

    const [row] = await db
      .update(integrations)
      .set({
        ...(update.displayName === undefined ? {} : { displayName: update.displayName }),
        ...(update.status === undefined ? {} : { status: update.status }),
        updatedAt: new Date(),
      })
      .where(and(eq(integrations.id, integrationId), eq(integrations.organizationId, principal.organizationId)))
      .returning({
        id: integrations.id,
        displayName: integrations.displayName,
        provider: integrations.provider,
        status: integrations.status,
      });

    return row
      ? { id: row.id, name: row.displayName, provider: row.provider, status: row.status }
      : null;
  });
}

async function accessibleIntegrations(
  db: QueryDatabase,
  organizationId: string,
  userId: string,
  access: "read" | "manage",
  integrationId?: string,
) {
  const permission = access === "manage" ? "integrations:manage" : "integrations:read";

  // TODO: Expand a membership scope through the organization-unit hierarchy;
  // this first slice authorizes an exact integration-binding unit match.
  return db
    .selectDistinct({
      id: integrations.id,
      displayName: integrations.displayName,
      provider: integrations.provider,
      status: integrations.status,
    })
    .from(integrations)
    .innerJoin(
      integrationBindings,
      and(
        eq(integrationBindings.integrationId, integrations.id),
        eq(integrationBindings.organizationId, organizationId),
        eq(integrationBindings.status, "active"),
      ),
    )
    .innerJoin(
      organizationMemberships,
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .innerJoin(
      membershipScopes,
      and(
        eq(membershipScopes.organizationId, organizationId),
        eq(membershipScopes.membershipId, organizationMemberships.id),
        eq(membershipScopes.organizationUnitId, integrationBindings.organizationUnitId),
        ...(access === "manage" ? [inArray(membershipScopes.access, ["manager", "admin"] as const)] : []),
      ),
    )
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, organizationMemberships.roleId))
    .where(
      and(
        eq(integrations.organizationId, organizationId),
        ...(integrationId ? [eq(integrations.id, integrationId)] : []),
        or(eq(rolePermissions.permission, permission), eq(rolePermissions.permission, "integrations:manage")),
      ),
    );
}
