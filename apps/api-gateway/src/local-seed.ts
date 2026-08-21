import { initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { and, eq, isNull } from "drizzle-orm";
import {
  createDatabase,
  organizationInvites,
  organizationMemberships,
  organizationUnits,
  organizations,
  roles,
  users,
} from "@encois/persistence";

const projectId = process.env.IDENTITY_PLATFORM_PROJECT_ID?.trim() || "demo-encois";
const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
const email = process.env.LOCAL_AUTH_EMAIL?.trim().toLowerCase() || "dev@local.test";
const password = process.env.LOCAL_AUTH_PASSWORD?.trim() || "local-password-1234";
const organizationName = process.env.LOCAL_AUTH_ORGANIZATION?.trim() || "Encois Local";
const organizationSlug = process.env.LOCAL_AUTH_ORGANIZATION_SLUG?.trim() || "encois-local";
const databaseUrl = process.env.DATABASE_MIGRATION_URL?.trim();

if (!emulatorHost) throw new Error("FIREBASE_AUTH_EMULATOR_HOST is required for the local auth seed.");
if (!databaseUrl) throw new Error("DATABASE_MIGRATION_URL is required for the local auth seed.");
if (password.length < 6) throw new Error("LOCAL_AUTH_PASSWORD must contain at least six characters.");

const firebaseApp = initializeApp({ projectId }, `local-auth-seed-${projectId}`);
const auth = getAuth(firebaseApp);
const database = createDatabase({ url: databaseUrl });

async function waitForAuthEmulator(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await auth.getUserByEmail(email);
      return;
    } catch (error) {
      if ((error as { code?: string }).code === "auth/user-not-found") return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`Firebase Auth Emulator did not become ready at ${emulatorHost}.`);
}

async function ensureAuthUser(): Promise<UserRecord> {
  try {
    const existing = await auth.getUserByEmail(email);
    return auth.updateUser(existing.uid, { displayName: "Local Developer", emailVerified: true, password });
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    return auth.createUser({
      displayName: "Local Developer",
      email,
      emailVerified: true,
      password,
    });
  }
}

async function ensureOrganizationInvite(identitySubject: string): Promise<{ inviteId: string; organizationId: string }> {
  return database.db.transaction(async (tx) => {
    const [existingOrganization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, organizationSlug))
      .limit(1);
    const organization = existingOrganization ?? (
      await tx
        .insert(organizations)
        .values({ name: organizationName, slug: organizationSlug })
        .returning({ id: organizations.id })
    )[0];
    if (!organization) throw new Error("Local organization was not created.");

    const [existingRoot] = await tx
      .select({ id: organizationUnits.id })
      .from(organizationUnits)
      .where(
        and(
          eq(organizationUnits.organizationId, organization.id),
          eq(organizationUnits.slug, "root"),
          eq(organizationUnits.type, "organization"),
        ),
      )
      .limit(1);
    const root = existingRoot ?? (
      await tx
        .insert(organizationUnits)
        .values({
          organizationId: organization.id,
          type: "organization",
          slug: "root",
          name: organizationName,
        })
        .returning({ id: organizationUnits.id })
    )[0];
    if (!root) throw new Error("Local organization root was not created.");

    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.key, "organization_admin"), isNull(roles.organizationId)))
      .limit(1);
    if (!role) throw new Error("System organization_admin role is missing. Run migrations first.");

    const [existingUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.identityProvider, "identity-platform"), eq(users.identitySubject, identitySubject)))
      .limit(1);
    if (existingUser) {
      const [activeMembership] = await tx
        .select({ id: organizationMemberships.id })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organization.id),
            eq(organizationMemberships.userId, existingUser.id),
            eq(organizationMemberships.status, "active"),
          ),
        )
        .limit(1);
      if (activeMembership) return { inviteId: "already-active", organizationId: organization.id };
    }

    const [existingInvite] = await tx
      .select({ id: organizationInvites.id })
      .from(organizationInvites)
      .where(
        and(
          eq(organizationInvites.organizationId, organization.id),
          eq(organizationInvites.emailNormalized, email),
          eq(organizationInvites.status, "pending"),
        ),
      )
      .limit(1);
    const invite = existingInvite ?? (
      await tx
        .insert(organizationInvites)
        .values({
          emailNormalized: email,
          organizationId: organization.id,
          organizationUnitId: root.id,
          roleId: role.id,
        })
        .returning({ id: organizationInvites.id })
    )[0];
    if (!invite) throw new Error("Local organization invite was not created.");

    return { inviteId: invite.id, organizationId: organization.id };
  });
}

try {
  await waitForAuthEmulator();
  const user = await ensureAuthUser();
  const organization = await ensureOrganizationInvite(user.uid);

  console.log(
    JSON.stringify(
      {
        email,
        firebaseUid: user.uid,
        inviteId: organization.inviteId,
        organizationId: organization.organizationId,
        organizationSlug,
        note: "The Encois users row is intentionally created by /api/v1/auth/me after local login.",
      },
      null,
      2,
    ),
  );
} finally {
  await database.client.end({ timeout: 5 });
}
