import {
  type DatabaseTransaction,
  membershipScopes,
  organizationMemberships,
  roles,
  users,
} from "@encois/database";
import { and, eq, isNull } from "drizzle-orm";

export const localControlPlaneServiceUserId =
  "00000000-0000-4000-8000-000000000010";

export async function ensureLocalControlPlaneMembership(
  tx: DatabaseTransaction,
  organizationId: string,
  rootUnitId: string,
): Promise<void> {
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, localControlPlaneServiceUserId))
    .limit(1);
  if (!user) {
    await tx.insert(users).values({
      id: localControlPlaneServiceUserId,
      identityProvider: "identity-platform",
      identitySubject: "local-control-plane",
      email: "control-plane@local.test",
      displayName: "Local Control Plane",
    });
  }

  const [role] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(
      and(eq(roles.key, "organization_admin"), isNull(roles.organizationId)),
    )
    .limit(1);
  if (!role)
    throw new Error(
      "System organization_admin role is missing. Run database migrations first.",
    );

  const [existing] = await tx
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, localControlPlaneServiceUserId),
      ),
    )
    .limit(1);
  const membershipId =
    existing?.id ??
    (
      await tx
        .insert(organizationMemberships)
        .values({
          organizationId,
          userId: localControlPlaneServiceUserId,
          roleId: role.id,
          status: "active",
        })
        .returning({ id: organizationMemberships.id })
    )[0]?.id;
  if (!membershipId)
    throw new Error("Local control-plane membership was not persisted.");

  await tx
    .update(organizationMemberships)
    .set({ roleId: role.id, status: "active" })
    .where(eq(organizationMemberships.id, membershipId));
  await tx
    .insert(membershipScopes)
    .values({
      organizationId,
      membershipId,
      organizationUnitId: rootUnitId,
      access: "admin",
    })
    .onConflictDoUpdate({
      target: [
        membershipScopes.membershipId,
        membershipScopes.organizationUnitId,
      ],
      set: { access: "admin" },
    });
}
