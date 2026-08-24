import {
  createDatabase,
  organizationMemberships,
  organizations,
  users,
} from "@encois/persistence";
import { eq, inArray } from "drizzle-orm";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const projectId =
  process.env.IDENTITY_PLATFORM_PROJECT_ID?.trim() || "demo-encois";
const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
const databaseUrl = process.env.DATABASE_MIGRATION_URL?.trim();
const fixtureOrganizationSlugs = [
  "organization-sun",
  "organization-test",
  "organization-avengers",
  "encois-local",
] as const;
const fixtureEmails = [
  "owner@local.test",
  "dev@local.test",
  "manager@local.test",
  "viewer@local.test",
  "test@local.test",
  "avengers-owner@local.test",
  "avengers-manager@local.test",
  "onboarding1@local.test",
  "onboarding2@local.test",
  "onboarding3@local.test",
  "onboarding4@local.test",
  "onboarding5@local.test",
  "member@local.test",
  "dev@localtest",
];

if (process.env.NODE_ENV === "production")
  throw new Error("The local auth reset cannot run in production.");
if (!emulatorHost)
  throw new Error(
    "FIREBASE_AUTH_EMULATOR_HOST is required for the local reset.",
  );
if (!databaseUrl)
  throw new Error("DATABASE_MIGRATION_URL is required for the local reset.");

const firebaseApp = initializeApp(
  { projectId },
  `local-auth-reset-${projectId}`,
);
const auth = getAuth(firebaseApp);
const database = createDatabase({ url: databaseUrl });

try {
  const deletedOrganizations = await database.db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(inArray(organizations.slug, [...fixtureOrganizationSlugs]));
    if (rows.length > 0)
      await tx.delete(organizations).where(
        inArray(
          organizations.id,
          rows.map(({ id }) => id),
        ),
      );

    const fixtureUsers = await tx
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, fixtureEmails));
    for (const user of fixtureUsers) {
      const [membership] = await tx
        .select({ id: organizationMemberships.id })
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, user.id))
        .limit(1);
      if (!membership) await tx.delete(users).where(eq(users.id, user.id));
    }
    return rows.length;
  });

  let deletedAuthUsers = 0;
  for (const email of fixtureEmails) {
    try {
      const user = await auth.getUserByEmail(email);
      await auth.deleteUser(user.uid);
      deletedAuthUsers += 1;
    } catch (error) {
      if ((error as { code?: string }).code !== "auth/user-not-found")
        throw error;
    }
  }

  console.log(
    JSON.stringify(
      { deletedOrganizations, deletedAuthUsers, emulatorHost },
      null,
      2,
    ),
  );
} finally {
  await database.client.end({ timeout: 5 });
}
